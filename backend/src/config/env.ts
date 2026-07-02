import { z } from "zod";

// Validated at boot; fails fast on misconfiguration. v1 is Discord-only: identity
// is the Discord user id, so there is no auth-service / OAuth config here (the
// `users.auth_sub` seam is reserved for the phase-3 web dashboard).
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
  // On startup Aivo catches up on messages it missed while offline (see
  // discord/catchup.ts). When it answers a message older than this many minutes,
  // it prefixes the reply with a short note that it was offline so the delay is
  // explained. Set to 0 to acknowledge every caught-up message.
  OFFLINE_ACK_THRESHOLD_MINUTES: z.coerce.number().int().nonnegative().default(15),

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
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validate the environment. Throws (fail fast) on misconfiguration. Called once at
 * the composition root (`server.ts`/`bootstrap.ts`); the resulting values are threaded
 * through the DI seams ({@link AgentConfig} on `AgentDeps`, {@link DiscordConfig} on the
 * gateway) rather than imported as a module singleton, so core logic never reaches for
 * `process.env` and tests can vary config per-case without mutating shared module state.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
