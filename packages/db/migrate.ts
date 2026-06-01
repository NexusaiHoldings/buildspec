#!/usr/bin/env node
/**
 * Substrate DB migration runner — Sprint substrate-db-migration-runner-001 (2026-05-21).
 *
 * Reads all `*_DDL` / `*_SCHEMA_SQL` constants from `packages/db/company/*.ts`
 * and executes them in sequence against `DATABASE_URL`.
 *
 * Runs as a turbo `migrate` task BEFORE `web#build` (per root turbo.json
 * dependsOn chain) so the database has its tables before Next.js's static
 * generation or any server-component pre-render queries the DB.
 *
 * Idempotent: relies on CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
 * in the DDL constants. Safe to re-run on every build.
 *
 * Failure modes:
 *   - DATABASE_URL not set    → log + exit 0 (preview/dev environments)
 *   - DB connection fails     → exit 1, build fails (Vercel surfaces error)
 *   - DDL SQL error           → exit 1, build fails
 *   - No DDL constants found  → exit 0 (substrate without per-company tables)
 *
 * Live evidence (Verifolio, 2026-05-21): pre-fix the substrate's packages/db/
 * index.ts was a stub. Verifolio's Neon DB had ZERO tables. F1-003's /templates
 * page queried coi_compliance_templates → asyncpg.UndefinedColumnError → HTTP
 * 500. This script closes that gap by running the DDL at build time.
 */

import { readdirSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";

interface DdlEntry {
  file: string;
  constant: string;
  sql: string;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[db/migrate] DATABASE_URL not set — skipping migration");
    console.log("[db/migrate] (this is expected in local dev / Vercel preview without DB)");
    return;
  }

  const companyDir = resolve(__dirname, "company");
  let tsFiles: string[];
  try {
    tsFiles = readdirSync(companyDir).filter((f) => f.endsWith(".ts"));
  } catch (err) {
    console.log(`[db/migrate] No company/ directory at ${companyDir} — nothing to migrate`);
    return;
  }

  if (tsFiles.length === 0) {
    console.log("[db/migrate] No .ts files in packages/db/company/ — nothing to migrate");
    return;
  }

  const ddls: DdlEntry[] = [];
  for (const file of tsFiles) {
    const fullPath = join(companyDir, file);
    let mod: Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(fullPath).href);
    } catch (err) {
      console.error(`[db/migrate] Failed to import ${file}: ${err}`);
      throw err;
    }
    for (const [name, value] of Object.entries(mod)) {
      if (
        typeof value === "string" &&
        (name.endsWith("_DDL") || name.endsWith("_SCHEMA_SQL"))
      ) {
        ddls.push({ file, constant: name, sql: value });
      }
    }
  }

  if (ddls.length === 0) {
    console.log(
      "[db/migrate] No *_DDL / *_SCHEMA_SQL constants in packages/db/company/ — nothing to migrate",
    );
    return;
  }

  console.log(`[db/migrate] Found ${ddls.length} DDL constant(s):`);
  for (const d of ddls) {
    console.log(`  - ${d.file}::${d.constant} (${d.sql.length} chars)`);
  }

  // Dynamic require for `pg` so tsx doesn't try to bundle Node-built-ins.
  // Same pattern apps/web uses (per compliance-evaluator.ts).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require("pg") as {
    Client: new (config: { connectionString: string }) => {
      connect: () => Promise<void>;
      query: (sql: string) => Promise<unknown>;
      end: () => Promise<void>;
    };
  };
  const client = new Client({ connectionString: dbUrl });

  await client.connect();
  console.log("[db/migrate] Connected to DATABASE_URL");

  let succeeded = 0;
  try {
    for (const d of ddls) {
      console.log(`[db/migrate] Executing ${d.file}::${d.constant} ...`);
      try {
        await client.query(d.sql);
        succeeded += 1;
        console.log(`[db/migrate]   OK ${d.file}::${d.constant}`);
      } catch (err) {
        console.error(
          `[db/migrate]   FAILED ${d.file}::${d.constant}: ${err}`,
        );
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log(
    `[db/migrate] Complete — ${succeeded}/${ddls.length} DDL constants applied`,
  );
}

main().catch((err) => {
  console.error("[db/migrate] FATAL:", err);
  process.exit(1);
});
