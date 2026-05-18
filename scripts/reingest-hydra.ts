#!/usr/bin/env tsx
/**
 * Bulk re-upload all existing sources through the fixed Hydra path so chunks
 * route under the correct sub_tenant_id. Reads each source's normalized text
 * by re-fetching its URL, then calls uploadKnowledge.
 *
 * Usage:
 *   pnpm tsx scripts/reingest-hydra.ts            # all sources
 *   pnpm tsx scripts/reingest-hydra.ts <url>      # one source by url
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

loadLocalEnv();

const DATABASE_URL = requireEnv("DATABASE_URL");
const HYDRA_API_KEY = requireEnv("HYDRA_API_KEY");
const HYDRA_TENANT_ID = requireEnv("HYDRA_TENANT_ID");
const HYDRA_BASE_URL = (process.env.HYDRA_BASE_URL ?? "https://api.hydradb.com").replace(/\/$/, "");
const HYDRA_SUB_TENANT = process.env.HYDRA_SUB_TENANT_ID ?? "wikithon-ai-industry";

const THROTTLE_MS = 500;

interface SourceRow {
  id: string;
  url: string | null;
  title: string;
  publisher: string | null;
  published_at: string | null;
}

async function main() {
  const sql = neon(DATABASE_URL);
  const filterUrl = process.argv[2];
  const rows = (filterUrl
    ? await sql`SELECT id, url, title, publisher, published_at FROM sources WHERE url = ${filterUrl}`
    : await sql`SELECT id, url, title, publisher, published_at FROM sources ORDER BY ingested_at ASC`) as unknown as SourceRow[];

  if (rows.length === 0) {
    console.log("No sources matched.");
    return;
  }
  console.log(`Re-uploading ${rows.length} source(s) to Hydra under sub_tenant=${HYDRA_SUB_TENANT}...`);

  const { normalizeUrl } = await import("@/lib/normalize-source");

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    if (!row.url) {
      console.log(`skip (no url): ${row.id}`);
      continue;
    }
    try {
      const normalized = await normalizeUrl(row.url);
      if (!normalized.bodyText || normalized.bodyText.length < 200) {
        console.log(`skip (empty body): ${row.title}`);
        fail++;
        continue;
      }
      await uploadKnowledge({
        id: row.id,
        subTenantId: HYDRA_SUB_TENANT,
        source: normalized.publisher ?? row.publisher ?? "unknown",
        title: normalized.title || row.title,
        url: row.url,
        timestamp: normalized.publishedAt ?? row.published_at,
        text: normalized.bodyText,
        metadata: { topic_id: "ai-industry", reingest_run: new Date().toISOString() },
      });
      await sql`UPDATE sources SET hydra_status = 'queued' WHERE id = ${row.id}`;
      console.log(`ok: ${row.title}`);
      ok++;
    } catch (error) {
      console.error(`fail: ${row.title} —`, error instanceof Error ? error.message : error);
      fail++;
    }
    await sleep(THROTTLE_MS);
  }
  console.log(`\nDone. ok=${ok} fail=${fail} total=${rows.length}`);
}

async function uploadKnowledge(input: {
  id: string;
  subTenantId: string;
  source: string;
  title: string;
  url?: string | null;
  timestamp?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
}) {
  const body = new FormData();
  body.append("tenant_id", HYDRA_TENANT_ID);
  body.append("sub_tenant_id", input.subTenantId);
  body.append(
    "app_knowledge",
    JSON.stringify([
      {
        id: input.id,
        tenant_id: HYDRA_TENANT_ID,
        sub_tenant_id: input.subTenantId,
        source: input.source,
        title: input.title,
        url: input.url ?? null,
        timestamp: input.timestamp ?? null,
        content: { text: input.text },
        additional_metadata: input.metadata ?? {},
      },
    ]),
  );
  const response = await fetch(`${HYDRA_BASE_URL}/ingestion/upload_knowledge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HYDRA_API_KEY}`,
      accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hydra upload ${response.status}: ${text.slice(0, 200)}`);
  }
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
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
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
