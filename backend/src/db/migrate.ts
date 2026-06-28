import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner as migrationRunner } from "node-pg-migrate";

const MIGRATIONS_TABLE = "pgmigrations";

/**
 * Locate the plain-SQL migrations directory in both layouts:
 *  - bundled runtime: copied next to dist/server.js (tsup onSuccess) -> ./migrations
 *  - source/dev/tests: backend/migrations (this file is src/db/migrate.ts)
 */
function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, "migrations");
  if (existsSync(bundled)) return bundled;
  return path.join(here, "..", "..", "migrations");
}

export interface MigrateOptions {
  log?: (msg: string) => void;
}

/**
 * Apply all pending migrations. node-pg-migrate takes a Postgres advisory lock
 * by default, so concurrent boots (e.g. a brief rolling-update overlap) are safe.
 * Forward-only — no automated down migrations.
 *
 * Intentionally free of app config/logger imports so it can run inside the
 * Vitest global setup without a fully-configured environment.
 */
export async function runMigrations(
  databaseUrl: string,
  options: MigrateOptions = {},
): Promise<void> {
  await migrationRunner({
    databaseUrl,
    dir: migrationsDir(),
    direction: "up",
    migrationsTable: MIGRATIONS_TABLE,
    count: Infinity,
    log: options.log ?? (() => {}),
  });
}
