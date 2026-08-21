import type { Server } from "node:http";
import type { Pool } from "pg";
import { buildApp, type AppOptions } from "./app.js";
import type { AgentDeps } from "./agent/deps.js";
import { createAuthProvider } from "./auth/index.js";
import { systemClock } from "./agent/clock.js";
import { createDb } from "./db/kysely.js";
import { createPool } from "./db/pool.js";
import type { YoutubeIntegrations } from "./digest/pipeline.js";
import { createDiscordGateway, type DiscordGateway } from "./discord/client.js";
import { createDigestDeliverer } from "./discord/digestDelivery.js";
import { createReminderDeliverer } from "./discord/reminderDelivery.js";
import { createWeatherReportDeliverer } from "./discord/weatherDelivery.js";
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
import { UnforkedConnectionRepository } from "./storage/unforkedConnectionRepository.js";
import { UserRepository } from "./storage/userRepository.js";
import { VideoRepository } from "./storage/videoRepository.js";
import { WeatherLocationRepository } from "./storage/weatherLocationRepository.js";
import { YoutubeAccountRepository } from "./storage/youtubeAccountRepository.js";
import { YoutubeChannelRepository } from "./storage/youtubeChannelRepository.js";
import { createUnforkedClient } from "./unforked/client.js";
import { createWeatherClient } from "./weather/client.js";
import { createGeocoder } from "./weather/geocoder.js";
import { createYoutubeDataApi } from "./youtube/api.js";
import { createWatchPageTranscriptSource, type TranscriptSource } from "./youtube/transcripts.js";
import { loadEnv, type Env } from "./config/env.js";
import type { DiscordConfig } from "./discord/config.js";
import { logger } from "./logger.js";

export interface StartedServer {
  server: Server;
  pool: Pool;
  gateway: DiscordGateway;
}

/** The digest's YouTube integrations, or null until the OAuth secrets are configured. */
function buildYoutubeIntegrations(
  env: Env,
  transcripts: TranscriptSource,
): YoutubeIntegrations | null {
  if (!env.YOUTUBE_OAUTH_CLIENT_ID || !env.YOUTUBE_OAUTH_CLIENT_SECRET) return null;
  if (!env.YOUTUBE_OAUTH_REFRESH_TOKEN) return null;
  return {
    api: createYoutubeDataApi({
      clientId: env.YOUTUBE_OAUTH_CLIENT_ID,
      clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refreshToken: env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    }),
    transcripts,
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

  // unforked (family meal planner): the client reads the API key per call from
  // unforked_connection, so a key registered/replaced on the dashboard applies
  // without a restart. Null until UNFORKED_BASE_URL is configured.
  const unforkedConnection = new UnforkedConnectionRepository(db);
  const unforked = env.UNFORKED_BASE_URL
    ? createUnforkedClient({
        baseUrl: env.UNFORKED_BASE_URL,
        getApiKey: () => unforkedConnection.findApiKey(),
        timeoutMs: env.UNFORKED_TIMEOUT_MS,
      })
    : null;

  // Weather (MET Norway / yr.no) + geocoding (OSM Nominatim): keyless, so always wired.
  // Both send the same WEATHER_USER_AGENT their terms require.
  const weather = createWeatherClient({
    baseUrl: env.WEATHER_BASE_URL,
    userAgent: env.WEATHER_USER_AGENT,
    timeoutMs: env.WEATHER_TIMEOUT_MS,
  });
  const geocoder = createGeocoder({
    baseUrl: env.GEOCODER_BASE_URL,
    userAgent: env.WEATHER_USER_AGENT,
    timeoutMs: env.WEATHER_TIMEOUT_MS,
  });

  // One transcript scraper serves both the agent's youtube_summary tool and the
  // digest's stage 2 (keyless — no OAuth needed, unlike the Data API below).
  const transcripts = createWatchPageTranscriptSource();

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
    weatherLocations: new WeatherLocationRepository(db),
    llm: createOpenAiProvider({
      apiKey: env.LLM_API_KEY,
      baseURL: env.LLM_BASE_URL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxRetries: env.LLM_MAX_RETRIES,
    }),
    unforked,
    weather,
    geocoder,
    transcripts,
    clock: systemClock,
    ownerDiscordUserId: env.OWNER_DISCORD_USER_ID,
    config: {
      agentMaxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
      turnCostCeilingMultiplier: env.AGENT_TURN_COST_CEILING_MULTIPLIER,
      toolKeywordGating: env.AGENT_TOOL_KEYWORD_GATING,
      llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      contextMessageLimit: env.AGENT_CONTEXT_MESSAGE_LIMIT,
      contextTokenBudget: env.AGENT_CONTEXT_TOKEN_BUDGET,
      toolResultMaxTokens: env.AGENT_TOOL_RESULT_MAX_TOKENS,
      memoryInjectLimit: env.AGENT_MEMORY_INJECT_LIMIT,
      approvalTtlMinutes: env.APPROVAL_TTL_MINUTES,
      voiceMaxDurationSecs: env.VOICE_MAX_DURATION_SECS,
      voiceMaxBytes: env.VOICE_MAX_BYTES,
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

  // Dashboard auth + API (phase 3): the provider is picked from env.authMode —
  // `sidecar` reads the homectl-auth-proxy's injected identity headers in prod,
  // `dev` is a fixed local principal so a local run needs no auth service. The SPA
  // is only served when WEB_ROOT is set (the Docker image sets it; dev leaves it to
  // Vite). The gateway logs in after the HTTP server starts, so the health probe
  // reads a ref that's filled in below — "disconnected" until then, never a crash.
  let gatewayRef: DiscordGateway | undefined;
  // The one-time YouTube OAuth handshake, when the client is configured. Resolved before
  // the app options because the dashboard also needs to know whether it exists — it links
  // the owner here to mint a fresh refresh token (#83).
  const youtubeOauth =
    env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.YOUTUBE_OAUTH_REDIRECT_URL
      ? {
          clientId: env.YOUTUBE_OAUTH_CLIENT_ID,
          clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
          redirectUrl: env.YOUTUBE_OAUTH_REDIRECT_URL,
        }
      : null;
  const appOptions: AppOptions = {
    auth: {
      provider: createAuthProvider({ mode: env.authMode }),
      dashboard: {
        users: deps.users,
        llmUsage: deps.llmUsage,
        budgetConfig: deps.budgetConfig,
        modelPricing: deps.modelPricing,
        settings: deps.settings,
        memories: deps.memories,
        digests: deps.digests,
        digestItems: deps.digestItems,
        videos: deps.videos,
        conversations: deps.conversations,
        messages: deps.messages,
        profiles: deps.profiles,
        feedback: deps.feedback,
        youtubeAccount: deps.youtubeAccount,
        unforkedConnection,
        unforked,
        config: {
          memoryInjectLimit: env.AGENT_MEMORY_INJECT_LIMIT,
          youtubeOauthConfigured: youtubeOauth !== null,
        },
        gatewayStatus: () => gatewayRef?.isReady() ?? false,
      },
    },
    webRoot: env.WEB_ROOT,
  };
  if (youtubeOauth) appOptions.youtubeOauth = youtubeOauth;
  const app = buildApp(appOptions);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "backend listening");
      resolve(s);
    });
  });

  const gateway = createDiscordGateway(deps, discordConfig);
  gatewayRef = gateway;
  await gateway.login();

  // Proactive work: the in-process scheduler polls every minute for due digests and
  // reminders and delivers them through the gateway (docs/technical-overview.md).
  const scheduler = startScheduler(deps, buildYoutubeIntegrations(env, transcripts), {
    digest: createDigestDeliverer(gateway.client, deps, discordConfig),
    reminder: createReminderDeliverer(gateway.client, deps, discordConfig),
    weather: createWeatherReportDeliverer(gateway.client, deps, discordConfig),
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
