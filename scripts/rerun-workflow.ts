#!/usr/bin/env tsx
/**
 * Re-run ingest steps for one or more URLs.
 *
 * Modes:
 *   default       full workflow (fetch -> Hydra upload -> poll -> extract ->
 *                 judge contradictions -> lede synthesis). Slow for large
 *                 catalogues because contradiction judging is quadratic per
 *                 entity.
 *   --quick       only fetch + normalize + body_excerpt update + claim
 *                 re-extraction + claim upsert. Skips Hydra re-upload,
 *                 contradiction judging, and lede synthesis. Use this when
 *                 you only need to backfill evidence_quote / body_excerpt
 *                 after schema or prompt changes.
 *
 * Usage:
 *   pnpm tsx scripts/rerun-workflow.ts <url> [<url> ...]
 *   pnpm tsx scripts/rerun-workflow.ts --all
 *   pnpm tsx scripts/rerun-workflow.ts --quick --all
 *   pnpm tsx scripts/rerun-workflow.ts --quick <url>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

loadLocalEnv();

const DATABASE_URL = requireEnv("DATABASE_URL");
const THROTTLE_MS = 750;
const BODY_EXCERPT_MAX_CHARS = 1500;

interface SourceRow {
  id: string;
  topic_id: string;
  url: string;
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes("--quick");
  const all = args.includes("--all");
  const urls = all ? [] : args.filter((arg) => arg.startsWith("http"));

  const sql = neon(DATABASE_URL);
  const sources = all
    ? ((await sql`SELECT id, topic_id, url FROM sources WHERE url IS NOT NULL ORDER BY ingested_at ASC`) as unknown as SourceRow[])
    : ((await sql`SELECT id, topic_id, url FROM sources WHERE url = ANY(${urls})`) as unknown as SourceRow[]);

  if (sources.length === 0) {
    console.error("No matching sources.");
    process.exit(1);
  }

  console.log(`${quick ? "Quick" : "Full"} re-run for ${sources.length} source(s)...`);

  let ok = 0;
  let fail = 0;
  for (const source of sources) {
    try {
      if (quick) {
        const { claimCount, evidenceCount } = await quickRerun(sql, source);
        console.log(`ok: ${source.url} (claims=${claimCount}, evidence=${evidenceCount})`);
      } else {
        const { runIngestWorkflow } = await import("@/lib/ingest-workflow");
        const result = await runIngestWorkflow(source.url);
        const claimCount = result.persistedClaims.length;
        const evidenceCount = result.persistedClaims.filter((c) => c.evidenceQuote).length;
        console.log(`ok: ${source.url} (claims=${claimCount}, evidence=${evidenceCount})`);
      }
      ok++;
    } catch (error) {
      console.error(`fail: ${source.url} —`, error instanceof Error ? error.message : error);
      fail++;
    }
    await sleep(THROTTLE_MS);
  }
  console.log(`\nDone. ok=${ok} fail=${fail} total=${sources.length}`);
}

async function quickRerun(sql: ReturnType<typeof neon>, source: SourceRow) {
  const { normalizeUrl } = await import("@/lib/normalize-source");
  const { extractClaims, canonicalizeEntities } = await import("@/lib/llm");
  const { stableClaimId } = await import("@/lib/demo-data");
  const { slugify } = await import("@/lib/utils");

  const normalized = await normalizeUrl(source.url);
  const excerpt = buildBodyExcerpt(normalized.bodyText);

  await sql`UPDATE sources SET body_excerpt = ${excerpt} WHERE id = ${source.id}`;

  const extracted = await extractClaims(normalized.bodyText);
  if (extracted.length === 0) return { claimCount: 0, evidenceCount: 0 };

  const canonicals = await canonicalizeEntities(extracted.map((c) => c.entity));
  const canonicalByRaw = new Map(canonicals.map((c) => [c.raw, c]));

  let claimCount = 0;
  let evidenceCount = 0;
  for (const claim of extracted) {
    const rawEntity = claim.entity.trim();
    if (!rawEntity) continue;
    const canonical = canonicalByRaw.get(rawEntity) ?? canonicals.find((c) => c.canonicalName === rawEntity);
    const canonicalName = canonical?.canonicalName ?? rawEntity;
    const entityType = canonical?.entityType ?? "PRODUCT";
    const entityId = slugify(canonicalName);

    await sql`
      INSERT INTO entities (id, topic_id, canonical_name, entity_type)
      VALUES (${entityId}, ${source.topic_id}, ${canonicalName}, ${entityType})
      ON CONFLICT (id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
    `;
    for (const alias of [rawEntity, canonicalName, ...(canonical?.aliases ?? [])]) {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) continue;
      await sql`
        INSERT INTO entity_aliases (alias, entity_id)
        VALUES (${normalizedAlias}, ${entityId})
        ON CONFLICT (alias, entity_id) DO NOTHING
      `;
    }

    const claimId = stableClaimId(source.id, claim.claim);
    const evidenceQuote = claim.evidenceQuote ?? null;
    await sql`
      INSERT INTO claims (id, source_id, entity_id, claim_text, stance, confidence, chunk_uuid, evidence_quote, extracted_at)
      VALUES (${claimId}, ${source.id}, ${entityId}, ${claim.claim}, ${claim.stance}, ${claim.confidence}, ${null}, ${evidenceQuote}, ${new Date().toISOString()})
      ON CONFLICT (id) DO UPDATE SET
        claim_text = EXCLUDED.claim_text,
        stance = EXCLUDED.stance,
        confidence = EXCLUDED.confidence,
        evidence_quote = COALESCE(EXCLUDED.evidence_quote, claims.evidence_quote),
        extracted_at = EXCLUDED.extracted_at
    `;
    claimCount++;
    if (evidenceQuote) evidenceCount++;
  }
  return { claimCount, evidenceCount };
}

function buildBodyExcerpt(bodyText: string | undefined | null): string | null {
  if (!bodyText) return null;
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= BODY_EXCERPT_MAX_CHARS) return normalized;
  return `${normalized.slice(0, BODY_EXCERPT_MAX_CHARS - 1).trimEnd()}…`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required.`);
  return v;
}

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
