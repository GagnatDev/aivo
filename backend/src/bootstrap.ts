import type { Server } from "node:http";
import type { Pool } from "pg";
import { buildApp } from "./app.js";
import { createDb } from "./db/kysely.js";
import { createPool } from "./db/pool.js";
import { createDiscordGateway, type DiscordGateway } from "./discord/client.js";
import type { HandleMessageDeps } from "./discord/handleMessage.js";
import { ConversationRepository } from "./storage/conversationRepository.js";
import { MessageRepository } from "./storage/messageRepository.js";
import { UserRepository } from "./storage/userRepository.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";

export interface StartedServer {
  server: Server;
  pool: Pool;
  gateway: DiscordGateway;
}

/**
 * Wire pool -> Kysely -> repositories, start the HTTP server (health probes), then
 * connect the Discord gateway. Migrations are run by the caller (server.ts) before
 * this.
 */
export async function startServer(connectionString?: string): Promise<StartedServer> {
  const pool = createPool(connectionString);
  const db = createDb(pool);

  const deps: HandleMessageDeps = {
    users: new UserRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    ownerDiscordUserId: env.OWNER_DISCORD_USER_ID,
  };

  const app = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "backend listening");
      resolve(s);
    });
  });

  const gateway = createDiscordGateway(deps);
  await gateway.login();

  registerShutdown(server, pool, gateway);
  return { server, pool, gateway };
}

/** Graceful shutdown: stop the gateway and HTTP server, then close the pool. */
function registerShutdown(server: Server, pool: Pool, gateway: DiscordGateway): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    void gateway.destroy().finally(() => {
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
