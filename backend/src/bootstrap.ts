import type { Server } from "node:http";
import type { Pool } from "pg";
import { buildApp, type AppOptions } from "./app.js";
import type { AgentDeps } from "./agent/deps.js";
import { systemClock } from "./agent/clock.js";
import { createDb } from "./db/kysely.js";
import { createPool } from "./db/pool.js";
import type { YoutubeIntegrations } from "./digest/pipeline.js";
import { createDiscordGateway, type DiscordGateway } from "./discord/client.js";
import { createDigestDeliverer } from "./discord/digestDelivery.js";
import { createReminderDeliverer } from "./discord/reminderDelivery.js";
import { createOpenAiProvider } from "./llm/openaiProvider.js";
import { startScheduler } from "./scheduler/cron.js";
import { BudgetConfigRepository } from "./storage/budgetConfigRepository.js";
import { ConversationRepository } from "./storage/conversationRepository.js";
import { DigestItemRepository } from "./storage/digestItemRepository.js";
import { DigestRepository } from "./storage/digestRepository.js";
import { FeedbackRepository } from "./storage/feedbackRepository.js";
import { LlmUsageRepository } from "./storage/llmUsageRepository.js";
import { MemoryRepository } from "./storage/memoryRepository.js";
import { MessageRepository } from "./storage/messageRepository.js";
import { ModelPricingRepository } from "./storage/modelPricingRepository.js";
import { PendingApprovalRepository } from "./storage/pendingApprovalRepository.js";
import { ProfileRepository } from "./storage/profileRepository.js";
import { ReminderRepository } from "./storage/reminderRepository.js";
import { SettingsPermissionsRepository } from "./storage/settingsPermissionsRepository.js";
import { SettingsRepository } from "./storage/settingsRepository.js";
import { UserRepository } from "./storage/userRepository.js";
import { VideoRepository } from "./storage/videoRepository.js";
import { YoutubeAccountRepository } from "./storage/youtubeAccountRepository.js";
import { YoutubeChannelRepository } from "./storage/youtubeChannelRepository.js";
import { createYoutubeDataApi } from "./youtube/api.js";
import { createWatchPageTranscriptSource } from "./youtube/transcripts.js";
import { loadEnv, type Env } from "./config/env.js";
import type { DiscordConfig } from "./discord/config.js";
import { logger } from "./logger.js";

export interface StartedServer {
  server: Server;
  pool: Pool;
  gateway: DiscordGateway;
}

/** The digest's YouTube integrations, or null until the OAuth secrets are configured. */
function buildYoutubeIntegrations(env: Env): YoutubeIntegrations | null {
  if (!env.YOUTUBE_OAUTH_CLIENT_ID || !env.YOUTUBE_OAUTH_CLIENT_SECRET) return null;
  if (!env.YOUTUBE_OAUTH_REFRESH_TOKEN) return null;
  return {
    api: createYoutubeDataApi({
      clientId: env.YOUTUBE_OAUTH_CLIENT_ID,
      clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refreshToken: env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    }),
    transcripts: createWatchPageTranscriptSource(),
  };
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
    profiles: new ProfileRepository(db),
    reminders: new ReminderRepository(db),
    youtubeAccount: new YoutubeAccountRepository(db),
    youtubeChannels: new YoutubeChannelRepository(db),
    videos: new VideoRepository(db),
    digests: new DigestRepository(db),
    digestItems: new DigestItemRepository(db),
    feedback: new FeedbackRepository(db),
    llm: createOpenAiProvider({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL }),
    clock: systemClock,
    ownerDiscordUserId: env.OWNER_DISCORD_USER_ID,
    config: {
      agentMaxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
      llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      contextMessageLimit: env.AGENT_CONTEXT_MESSAGE_LIMIT,
      memoryInjectLimit: env.AGENT_MEMORY_INJECT_LIMIT,
      approvalTtlMinutes: env.APPROVAL_TTL_MINUTES,
    },
  };

  const discordConfig: DiscordConfig = {
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    homeChannelId: env.DISCORD_HOME_CHANNEL_ID,
    youtubeChannelId: env.DISCORD_YOUTUBE_CHANNEL_ID ?? null,
    offlineAckThresholdMinutes: env.OFFLINE_ACK_THRESHOLD_MINUTES,
  };

  // Stale approval prompts are swept by the scheduler's minutely tick (scheduler/tick.ts).

  // Mount the one-time YouTube OAuth handshake only when the client is configured.
  const appOptions: AppOptions = {};
  if (
    env.YOUTUBE_OAUTH_CLIENT_ID &&
    env.YOUTUBE_OAUTH_CLIENT_SECRET &&
    env.YOUTUBE_OAUTH_REDIRECT_URL
  ) {
    appOptions.youtubeOauth = {
      clientId: env.YOUTUBE_OAUTH_CLIENT_ID,
      clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      redirectUrl: env.YOUTUBE_OAUTH_REDIRECT_URL,
    };
  }
  const app = buildApp(appOptions);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "backend listening");
      resolve(s);
    });
  });

  const gateway = createDiscordGateway(deps, discordConfig);
  await gateway.login();

  // Proactive work: the in-process scheduler polls every minute for due digests and
  // reminders and delivers them through the gateway (docs/technical-overview.md).
  const scheduler = startScheduler(deps, buildYoutubeIntegrations(env), {
    digest: createDigestDeliverer(gateway.client, deps, discordConfig),
    reminder: createReminderDeliverer(gateway.client, deps, discordConfig),
  });

  registerShutdown(server, pool, gateway, () => void scheduler.stop());
  return { server, pool, gateway };
}

/** Graceful shutdown: stop the scheduler, gateway, and HTTP server, then the pool. */
function registerShutdown(
  server: Server,
  pool: Pool,
  gateway: DiscordGateway,
  stopScheduler: () => void,
): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    stopScheduler();
    void gateway.destroy().finally(() => {
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
