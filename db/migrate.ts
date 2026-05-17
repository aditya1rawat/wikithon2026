import { neon } from "@neondatabase/serverless";
import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

async function main() {
  const sql = neon(databaseUrl);
  const migrationPath = path.join(process.cwd(), "db", "migrations", "0001_consensuswiki.sql");
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

  console.log(`Applied ${statements.length} migration statements from ${path.relative(process.cwd(), migrationPath)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
