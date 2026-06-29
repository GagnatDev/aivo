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
});

export type Env = z.infer<typeof EnvSchema>;

/** Validate the environment. Throws (fail fast) on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

export const env: Env = loadEnv();
