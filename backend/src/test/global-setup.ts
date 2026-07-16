import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../db/migrate.js";

// Expose the container connection URI to test files via Vitest's inject().
declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

// One real Postgres for the whole test run; migrations applied once. Tests get
// isolation via TRUNCATE between cases (see test/db.ts). Set TEST_DATABASE_URL to
// point at an already-running Postgres instead (for environments without Docker);
// the suite TRUNCATEs and migrates it, so never point this at real data.
export async function setup({ provide }: TestProject): Promise<void> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    await runMigrations(external);
    provide("databaseUrl", external);
    return;
  }
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const uri = container.getConnectionUri();
  await runMigrations(uri);
  provide("databaseUrl", uri);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
