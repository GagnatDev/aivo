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
  // Agent tool-calling loop: hard cap on tool round-trips per turn (runaway backstop).
  AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(5),
  // How many recent messages of conversation history to include as context.
  // Re-sent on every LLM call (and on every tool-loop round-trip), so this is a
  // direct input-token lever — keep it as low as context quality allows.
  AGENT_CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().positive().default(15),
  // How many remembered facts to inject into the system prompt each turn (pinned
  // first, then newest). The rest stay reachable on demand via the memory tool;
  // this caps unbounded growth of the per-call prompt.
  AGENT_MEMORY_INJECT_LIMIT: z.coerce.number().int().positive().default(20),
  // A pending approval-gate prompt older than this is swept to `expired`.
  APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  // unforked (family meal planner) machine API — the in-cluster, ingress-less
  // `unforked-machine` Service (unforked docs/aivo-integration.md), e.g.
  // http://unforked-machine.homectl. The API key deliberately does NOT live in
  // the env: the owner registers it from the dashboard's Settings page and it
  // is stored in the unforked_connection table. Unset disables the capability
  // (the tool and the dashboard section report "not configured").
  UNFORKED_BASE_URL: z.string().url().optional(),

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
