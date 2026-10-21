import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  migrationRunner: vi.fn(),
}));

vi.mock("node-pg-migrate", () => ({
  runner: mocks.migrationRunner,
}));

import { MIGRATIONS_TABLE, runMigrations } from "./migrate.js";

describe("runMigrations", () => {
  beforeEach(() => {
    mocks.migrationRunner.mockReset();
    mocks.migrationRunner.mockResolvedValue([]);
  });

  it("waits for the advisory lock so overlapping boots do not fail", async () => {
    await runMigrations("postgresql://test:test@localhost:5432/aivo");

    expect(mocks.migrationRunner).toHaveBeenCalledOnce();
    expect(mocks.migrationRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseUrl: "postgresql://test:test@localhost:5432/aivo",
        direction: "up",
        migrationsTable: MIGRATIONS_TABLE,
        advisoryLockMode: "wait",
      }),
    );
  });
});
