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
 * Truncate all tables for per-test isolation (schema/migrations are preserved). The
 * CASCADE from `users` clears every user-scoped table (conversations, messages,
 * memories, settings, llm_usage, budget_config, pending_approvals, profiles, digests,
 * reminders);
 * `youtube_account`, `youtube_channels` and `unforked_connection` are account-scoped
 * rather than user-scoped (docs/data-model.md), so they're truncated explicitly — the
 * CASCADE from `youtube_channels` clears `videos` (and any digest_items). It deliberately does NOT
 * touch the two non-user-scoped, migration-seeded tables — `model_pricing`
 * (cheap/premium placeholder rows) and `settings_permissions` (the allow-list
 * singleton) — so their seed data survives across tests. A test that mutates pricing
 * should restore it or use distinct model ids.
 */
export async function resetDb(): Promise<void> {
  await sql`TRUNCATE users, youtube_account, youtube_channels, unforked_connection RESTART IDENTITY CASCADE`.execute(
    testDb(),
  );
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
