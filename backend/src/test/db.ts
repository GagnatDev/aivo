import { sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeEach, inject } from "vitest";
import { createDb, type Db } from "../db/kysely.js";

let pool: Pool | undefined;
let db: Db | undefined;

/** Lazily build a Kysely instance against the shared Testcontainers Postgres. */
export function testDb(): Db {
  if (!db) {
    pool = new Pool({ connectionString: inject("databaseUrl") });
    db = createDb(pool);
  }
  return db;
}

/**
 * Truncate all tables for per-test isolation (schema/migrations are preserved).
 * The CASCADE from `users` clears conversations and messages too.
 */
export async function resetDb(): Promise<void> {
  await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(testDb());
}

/** Close the worker's pool. */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Register the standard per-file DB lifecycle: truncate before each test, close after all. */
export function useCleanDb(): void {
  beforeEach(resetDb);
  afterAll(closeTestDb);
}
