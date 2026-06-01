/**
 * Substrate Db adapter — implements @nexus/identity-and-access's Db interface
 * (and any other lego that needs DB access) using `pg` + a singleton Pool.
 *
 * Sprint substrate-auth-routes-001 (2026-05-21).
 *
 * Pattern: eval("require")("pg") to bypass webpack bundling (same pattern
 * agent-generated app code uses — pg ships Node-built-in net/tls modules
 * that can't be polyfilled). DATABASE_URL is read at first-call time so
 * Vercel preview deploys without a DB can still build (they just fail
 * at runtime when the route is hit, which is the right shape for preview).
 */

import type { Db } from "@nexus/identity-and-access/api/_lib/db";

// Same import pattern as agent-generated code (e.g., compliance-evaluator.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

/**
 * Build a Db that conforms to the lego's interface.
 *
 * Used by substrate route shims: each request builds a context and passes
 * this Db to the lego handler.
 */
export function buildDb(): Db {
  return {
    async query<T = Record<string, unknown>>(
      sql: string,
      ...params: unknown[]
    ): Promise<T[]> {
      const pool = getPool();
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async execute(sql: string, ...params: unknown[]): Promise<void> {
      const pool = getPool();
      await pool.query(sql, params);
    },
  };
}
