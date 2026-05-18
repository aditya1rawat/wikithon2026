#!/usr/bin/env tsx
/**
 * Re-run the full ingest workflow (fetch -> normalize -> Hydra upload -> claim
 * extraction -> contradiction judging -> lede synthesis) for one or more URLs.
 * Useful after schema or prompt changes that require re-populating evidence
 * quotes / body excerpts / re-judging claims.
 *
 * Usage:
 *   pnpm tsx scripts/rerun-workflow.ts <url> [<url> ...]
 *   pnpm tsx scripts/rerun-workflow.ts --all          # every source in DB
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

loadLocalEnv();

const DATABASE_URL = requireEnv("DATABASE_URL");
const THROTTLE_MS = 750;

async function main() {
  const args = process.argv.slice(2);
  const urls = args.includes("--all")
    ? await loadAllUrls()
    : args.filter((arg) => arg.startsWith("http"));

  if (urls.length === 0) {
    console.error("No URLs provided. Pass one or more URLs or --all.");
    process.exit(1);
  }

  console.log(`Re-running ingest workflow for ${urls.length} source(s)...`);

  const { runIngestWorkflow } = await import("@/lib/ingest-workflow");

  let ok = 0;
  let fail = 0;
  for (const url of urls) {
    try {
      const result = await runIngestWorkflow(url);
      const claimCount = result.persistedClaims.length;
      const withEvidence = result.persistedClaims.filter((c) => c.evidenceQuote).length;
      console.log(`ok: ${url} (claims=${claimCount}, evidence=${withEvidence})`);
      ok++;
    } catch (error) {
      console.error(`fail: ${url} —`, error instanceof Error ? error.message : error);
      fail++;
    }
    await sleep(THROTTLE_MS);
  }
  console.log(`\nDone. ok=${ok} fail=${fail} total=${urls.length}`);
}

async function loadAllUrls() {
  const sql = neon(DATABASE_URL);
  const rows = (await sql`SELECT url FROM sources WHERE url IS NOT NULL ORDER BY ingested_at ASC`) as unknown as { url: string }[];
  return rows.map((row) => row.url);
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
