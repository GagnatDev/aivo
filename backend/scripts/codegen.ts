#!/usr/bin/env tsx
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { runSchemaCodegen } from "../src/db/codegen.js";
import { runMigrations } from "../src/db/migrate.js";

// Regenerate backend/src/db/schema.ts from the migrations (see
// docs/architecture-improvements.md §1.10). Spins up the same throwaway Postgres the
// test suite uses, applies every migration, then introspects it. Pass `--check` to
// verify the committed file is up to date (non-zero exit on drift) instead of rewriting
// it — used by the drift-check test and available for manual/CI runs.
//
//   pnpm db:codegen         # rewrite schema.ts
//   pnpm db:codegen:check   # fail if schema.ts is stale

const verify = process.argv.slice(2).some((arg) => arg === "--check" || arg === "--verify");

const container = await new PostgreSqlContainer("postgres:16-alpine").start();
try {
  const url = container.getConnectionUri();
  await runMigrations(url);
  await runSchemaCodegen(url, { verify });
  console.log(verify ? "✓ src/db/schema.ts is up to date." : "✓ Regenerated src/db/schema.ts.");
} catch (error) {
  if (verify) {
    console.error("✗ src/db/schema.ts is out of date — run `pnpm db:codegen` and commit the result.");
  }
  throw error;
} finally {
  await container.stop();
}
