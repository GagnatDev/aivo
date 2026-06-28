import { startServer } from "./bootstrap.js";
import { runMigrations } from "./db/migrate.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";

// Production entry point: migrate at boot (before listening), then start.
async function main(): Promise<void> {
  await runMigrations(env.DATABASE_URL, { log: (msg) => logger.info(msg) });
  await startServer();
}

main().catch((err: unknown) => {
  logger.error(err, "failed to start backend");
  process.exit(1);
});
