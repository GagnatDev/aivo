import type { Server } from "node:http";
import type { Pool } from "pg";
import { buildApp } from "./app.js";
import type { AgentDeps } from "./agent/deps.js";
import { systemClock } from "./agent/clock.js";
import { createDb } from "./db/kysely.js";
import { createPool } from "./db/pool.js";
import { createDiscordGateway, type DiscordGateway } from "./discord/client.js";
import { createOpenAiProvider } from "./llm/openaiProvider.js";
import { BudgetConfigRepository } from "./storage/budgetConfigRepository.js";
import { ConversationRepository } from "./storage/conversationRepository.js";
import { LlmUsageRepository } from "./storage/llmUsageRepository.js";
import { MemoryRepository } from "./storage/memoryRepository.js";
import { MessageRepository } from "./storage/messageRepository.js";
import { ModelPricingRepository } from "./storage/modelPricingRepository.js";
import { PendingApprovalRepository } from "./storage/pendingApprovalRepository.js";
import { SettingsPermissionsRepository } from "./storage/settingsPermissionsRepository.js";
import { SettingsRepository } from "./storage/settingsRepository.js";
import { UserRepository } from "./storage/userRepository.js";
import { loadEnv } from "./config/env.js";
import type { DiscordConfig } from "./discord/config.js";
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
  // The composition root: validate the environment once, then thread the values through
  // the DI seams (AgentConfig on AgentDeps, DiscordConfig on the gateway) so no module
  // downstream imports an env singleton.
  const env = loadEnv();
  const pool = createPool(connectionString ?? env.DATABASE_URL);
  const db = createDb(pool);

  const deps: AgentDeps = {
    users: new UserRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    memories: new MemoryRepository(db),
    settings: new SettingsRepository(db),
    settingsPermissions: new SettingsPermissionsRepository(db),
    modelPricing: new ModelPricingRepository(db),
    llmUsage: new LlmUsageRepository(db),
    budgetConfig: new BudgetConfigRepository(db),
    pendingApprovals: new PendingApprovalRepository(db),
    llm: createOpenAiProvider({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL }),
    clock: systemClock,
    ownerDiscordUserId: env.OWNER_DISCORD_USER_ID,
    config: {
      agentMaxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
      llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      contextMessageLimit: env.AGENT_CONTEXT_MESSAGE_LIMIT,
      memoryInjectLimit: env.AGENT_MEMORY_INJECT_LIMIT,
    },
  };

  const discordConfig: DiscordConfig = {
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    homeChannelId: env.DISCORD_HOME_CHANNEL_ID,
    offlineAckThresholdMinutes: env.OFFLINE_ACK_THRESHOLD_MINUTES,
  };

  // Sweep any approval prompts left pending across a restart so stale buttons resolve.
  void deps.pendingApprovals
    .expireOlderThan(new Date(deps.clock.now().getTime() - env.APPROVAL_TTL_MINUTES * 60_000))
    .catch((err: unknown) => logger.error(err, "failed to sweep stale approvals"));

  const app = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "backend listening");
      resolve(s);
    });
  });

  const gateway = createDiscordGateway(deps, discordConfig);
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
