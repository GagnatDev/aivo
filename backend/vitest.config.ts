import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Testcontainers + pg behave more predictably with process isolation.
    pool: "forks",
    // One shared Postgres container for the whole run; migrations applied once.
    globalSetup: ["src/test/global-setup.ts"],
    // Test files share that single database and reset via TRUNCATE between tests,
    // so they must not run concurrently or they'd truncate each other's data.
    fileParallelism: false,
    // Core logic no longer imports the `env` singleton (config is injected via
    // AgentDeps/DiscordConfig), so modules load in tests without a full env. The DB
    // connection string is the one value still read directly; the Testcontainers
    // global setup provides the real one (see test/db.ts), this is just a placeholder
    // for anything that reads it before that.
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Entry points and thin framework wiring are exercised by integration tests,
      // not unit tests. Coverage targets business logic.
      exclude: [
        "src/**/*.test.ts",
        "src/server.ts",
        "src/bootstrap.ts",
        "src/db/pool.ts",
        "src/db/kysely.ts",
        "src/db/schema.ts",
        "src/db/schema.enums.ts",
        "src/db/codegen.ts",
        "src/db/migrate.ts",
        "src/logger.ts",
        "src/discord/client.ts",
        "src/test/**",
      ],
    },
  },
});
