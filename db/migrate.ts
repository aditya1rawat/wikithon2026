import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
  const sql = neon(databaseUrl);
  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  let total = 0;
  for (const file of files) {
    const migrationPath = path.join(migrationsDir, file);
    const migration = (await readFile(migrationPath, "utf8"))
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const statements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await sql.query(statement);
    }
    total += statements.length;
    console.log(`Applied ${statements.length} statements from ${path.relative(process.cwd(), migrationPath)}.`);
  }
  console.log(`Migrations complete: ${total} statements across ${files.length} files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}
