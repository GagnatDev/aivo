import { z } from "zod";

// Validated at boot; fails fast on misconfiguration.
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.string().optional(),

  // Discord. The bot connects to one private guild; messages from other guilds
  // (or from bots) are ignored. OWNER_DISCORD_USER_ID flags the is_owner user on
  // just-in-time provisioning.
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_APP_ID: z.string().min(1, "DISCORD_APP_ID is required"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
  OWNER_DISCORD_USER_ID: z.string().min(1, "OWNER_DISCORD_USER_ID is required"),
  // If set, Aivo responds freely only in this channel; elsewhere only on mention
  // or reply to one of Aivo's messages.
  DISCORD_HOME_CHANNEL_ID: z.string().min(1, "DISCORD_HOME_CHANNEL_ID is required"),
  // The #youtube channel for digest delivery + feedback (Aivo answers everything
  // there, like the home channel). Optional: unset falls back to the home channel.
  DISCORD_YOUTUBE_CHANNEL_ID: z.string().min(1).optional(),
  // On startup Aivo catches up on messages it missed while offline (see
  // discord/catchup.ts). When it answers a message older than this many minutes,
  // it prefixes the reply with a short note that it was offline so the delay is
  // explained. Set to 0 to acknowledge every caught-up message.
  OFFLINE_ACK_THRESHOLD_MINUTES: z.coerce.number().int().nonnegative().default(15),

  // YouTube Data API OAuth (the single owner-connected account whose subscriptions
  // feed the digest). All three must be set for the digest to run; until then the
  // scheduler stays idle and the rest of Aivo works normally. The refresh token is
  // minted once via /youtube/oauth/start (see routes/youtubeOauth.ts), which also
  // needs YOUTUBE_OAUTH_REDIRECT_URL (e.g. https://aivo.homectl.no/youtube/oauth/callback).
  YOUTUBE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  YOUTUBE_OAUTH_REFRESH_TOKEN: z.string().min(1).optional(),
  YOUTUBE_OAUTH_REDIRECT_URL: z.string().url().optional(),

  // LLM provider: the official OpenAI SDK pointed at an OpenAI-compatible endpoint
  // (Scaleway's generative API). Model ids and prices deliberately do NOT live here —
  // they're in the model_pricing table so the owner can swap models / refresh prices
  // from chat without a redeploy.
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z.string().url("LLM_BASE_URL must be a URL"),
  // Upper bound on completion tokens per call; also the worst-case the approval-gate
  // cost estimate assumes for output.
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  // Per-call timeout (ms) for LLM calls. Explicit so a wedged provider fails fast
  // (suited to chat UX) instead of the SDK's silent 10-minute default holding the
  // Discord typing indicator.
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  // Retries for transient LLM failures (rate limit, 5xx, network) with exponential
  // backoff + jitter, honoring Retry-After (llm/retry.ts). Auth errors never retry.
  // 0 disables retrying entirely.
  LLM_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  // Agent tool-calling loop: hard cap on tool round-trips per turn (runaway backstop).
  AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(5),
  // In-flight cost ceiling for one turn, as a multiple of the user's approval
  // threshold. The pre-call approval gate only prices the FIRST call's worst case; a
  // turn then runs up to AGENT_MAX_TOOL_ITERATIONS round-trips, each re-sending the
  // grown context. When a turn's actual accumulated cost reaches
  // threshold × this multiplier, the loop stops and forces a final answer instead of
  // spending another round-trip. Only applies when the approval threshold is set.
  AGENT_TURN_COST_CEILING_MULTIPLIER: z.coerce.number().positive().default(3),
  // Keyword-gate tool advertisement (see agent/tools/index.ts). Off by default: all
  // tool schemas are advertised every turn — a stable prompt prefix that caches well
  // and can't silently strip a capability on a missed keyword. Set to "true" to
  // reinstate the gate and trade that robustness for ~1-2k input tokens per call.
  AGENT_TOOL_KEYWORD_GATING: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Hard cap on how many recent history messages to replay — a backstop beneath the
  // token budget below, so a long run of tiny messages can't blow up prompt size.
  AGENT_CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().positive().default(30),
  // Token budget for replayed conversation history (the primary context lever). History
  // is re-sent on every LLM call and every tool-loop round-trip, so it's a direct
  // input-token cost — budgeting by tokens rather than message count keeps one large
  // message (e.g. a long tool result) from crowding out the rest of the window.
  AGENT_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4000),
  // Per-tool-result token cap applied at the loop boundary: a result larger than this is
  // truncated with a notice telling the model to narrow its request. Bounds the cost of a
  // large result being re-sent on every subsequent iteration. 0 disables the cap.
  AGENT_TOOL_RESULT_MAX_TOKENS: z.coerce.number().int().nonnegative().default(2000),
  // How many remembered facts to inject into the system prompt each turn (pinned
  // first, then newest). The rest stay reachable on demand via the memory tool;
  // this caps unbounded growth of the per-call prompt.
  AGENT_MEMORY_INJECT_LIMIT: z.coerce.number().int().positive().default(20),
  // A pending approval-gate prompt older than this is swept to `expired`.
  APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  // Voice messages: Discord voice notes are transcribed by the audio model (see the
  // model_pricing capabilities). Both caps are enforced before download (Discord reports
  // the clip's duration + size up front), so an over-cap note is rejected with a friendly
  // note and costs nothing. Kept modest at first to bound STT spend and latency.
  VOICE_MAX_DURATION_SECS: z.coerce.number().int().positive().default(60),
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),

  // unforked (family meal planner) machine API — the in-cluster, ingress-less
  // `unforked-machine` Service (unforked docs/aivo-integration.md), e.g.
  // http://unforked-machine.homectl. The API key deliberately does NOT live in
  // the env: the owner registers it from the dashboard's Settings page and it
  // is stored in the unforked_connection table. Unset disables the capability
  // (the tool and the dashboard section report "not configured").
  UNFORKED_BASE_URL: z.string().url().optional(),
  // Per-request timeout (ms) for the unforked machine API. Bounds every call so a
  // slow or wedged unforked (e.g. a write blocked on a row lock, or a pod restarting
  // mid-deploy) fails fast with an honest error instead of hanging the agent turn on
  // undici's multi-minute default — which used to leave the model with no result and
  // confabulating an explanation to the owner.
  UNFORKED_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Weather (MET Norway / yr.no forecasts) + geocoding (OpenStreetMap Nominatim). Both
  // are free and keyless, but their terms of service require a descriptive User-Agent
  // that identifies the app and a contact. WEATHER_USER_AGENT is that string — the
  // default keeps local/dev working, but set a real contact in production. The base URLs
  // are overridable (e.g. a self-hosted mirror). The weather capability is on whenever
  // WEATHER_USER_AGENT resolves, which — given the default — is always.
  WEATHER_USER_AGENT: z.string().min(1).default("aivo/1.0 (+https://github.com/GagnatDev/aivo)"),
  WEATHER_BASE_URL: z.string().url().default("https://api.met.no/weatherapi/locationforecast/2.0"),
  GEOCODER_BASE_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  // Per-request timeout (ms) for both the forecast and geocoder calls, so a wedged
  // upstream fails fast with an honest error instead of hanging the agent turn.
  WEATHER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Dashboard auth. Aivo sits behind the homectl-auth-proxy sidecar
  // (homectl-auth docs/sidecar/integration.md): all OAuth config (PUBLIC_AUTH_URL,
  // AUTH_CLIENT_ID/SECRET, COOKIE_KEY, ...) lives on the *sidecar* container, not
  // here — the app only reads the identity headers the sidecar injects. AUTH_MODE
  // `sidecar` does exactly that; `dev` is a fixed local principal (no sidecar —
  // dev/tests run offline). Unset, it derives from NODE_ENV (see loadEnv).
  AUTH_MODE: z.enum(["dev", "sidecar"]).optional(),
  // Directory of the built dashboard SPA. Set in the Docker image; unset in dev
  // (Vite serves the frontend) so the backend skips static serving entirely.
  WEB_ROOT: z.string().min(1).optional(),
});

/** Validated env plus the derived auth mode (schema fields + `authMode`). */
export type Env = z.infer<typeof EnvSchema> & { authMode: "dev" | "sidecar" };

/**
 * Validate the environment. Throws (fail fast) on misconfiguration. Called once at
 * the composition root (`server.ts`/`bootstrap.ts`); the resulting values are threaded
 * through the DI seams ({@link AgentConfig} on `AgentDeps`, {@link DiscordConfig} on the
 * gateway) rather than imported as a module singleton, so core logic never reaches for
 * `process.env` and tests can vary config per-case without mutating shared module state.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.parse(source);
  // Convention (homectl-reference docs/conventions.md): real auth in prod unless
  // explicitly overridden, offline dev bypass everywhere else. In prod the app runs
  // behind the sidecar and reads its injected identity headers.
  const authMode = parsed.AUTH_MODE ?? (parsed.NODE_ENV === "production" ? "sidecar" : "dev");
  return { ...parsed, authMode };
}
