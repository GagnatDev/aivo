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
    // Default so unit tests can import modules that read config at load time
    // without a real database. Integration tests override DATABASE_URL via the
    // Testcontainers global setup. Discord vars are dummy-but-present so env.ts
    // (which validates them at import) loads in tests.
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_APP_ID: "test-app",
      DISCORD_GUILD_ID: "test-guild",
      OWNER_DISCORD_USER_ID: "test-owner",
      DISCORD_HOME_CHANNEL_ID: "test-home-channel",
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
        "src/db/migrate.ts",
        "src/logger.ts",
        "src/discord/client.ts",
        "src/test/**",
      ],
    },
  },
});
