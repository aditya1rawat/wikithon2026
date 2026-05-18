#!/usr/bin/env tsx
/**
 * Delete entities whose canonical_name fails isValidEntityName (stopwords,
 * pronouns, conjunctions, single characters, etc.) along with their claims,
 * aliases, ledes, and claim_relations.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-junk-entities.ts          # dry run
 *   pnpm tsx scripts/cleanup-junk-entities.ts --apply  # actually delete
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

loadLocalEnv();

const DATABASE_URL = requireEnv("DATABASE_URL");

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = neon(DATABASE_URL);
  const { isValidEntityName } = await import("@/lib/entity-validation");

  const entities = (await sql`SELECT id, canonical_name, entity_type FROM entities`) as unknown as {
    id: string;
    canonical_name: string;
    entity_type: string;
  }[];

  const junk = entities.filter((row) => !isValidEntityName(row.canonical_name));
  if (junk.length === 0) {
    console.log("No junk entities found.");
    return;
  }

  console.log(`Found ${junk.length} junk entit${junk.length === 1 ? "y" : "ies"}:`);
  for (const row of junk) console.log(`  ${row.id}  "${row.canonical_name}" (${row.entity_type})`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to delete.");
    return;
  }

  for (const row of junk) {
    const claims = (await sql`SELECT id FROM claims WHERE entity_id = ${row.id}`) as unknown as { id: string }[];
    const claimIds = claims.map((c) => c.id);
    if (claimIds.length > 0) {
      await sql`DELETE FROM claim_relations WHERE claim_a = ANY(${claimIds}) OR claim_b = ANY(${claimIds})`;
      await sql`DELETE FROM claims WHERE entity_id = ${row.id}`;
    }
    await sql`DELETE FROM entity_aliases WHERE entity_id = ${row.id}`;
    await sql`DELETE FROM ledes WHERE entity_id = ${row.id}`;
    await sql`DELETE FROM entities WHERE id = ${row.id}`;
    console.log(`deleted: ${row.id} (claims=${claimIds.length})`);
  }
  console.log(`\nDeleted ${junk.length} junk entit${junk.length === 1 ? "y" : "ies"}.`);
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
