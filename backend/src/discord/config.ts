/**
 * The Discord-layer config, populated once from `loadEnv()` at the composition root
 * and passed into {@link createDiscordGateway} and the router/catch-up functions.
 * Threading these through the gateway (rather than importing the `env` singleton)
 * keeps the routing policy testable — a test can vary the guild/home-channel/threshold
 * per-case without mutating shared module state.
 */
export interface DiscordConfig {
  /** Bot token used to log the gateway in. `DISCORD_BOT_TOKEN`. */
  botToken: string;
  /** The single guild Aivo serves; messages from other guilds are ignored. `DISCORD_GUILD_ID`. */
  guildId: string;
  /** In this channel Aivo answers everything; elsewhere only on mention/reply. `DISCORD_HOME_CHANNEL_ID`. */
  homeChannelId: string;
  /** A caught-up reply to a message older than this many minutes is prefixed with an
   * offline note. `OFFLINE_ACK_THRESHOLD_MINUTES`. */
  offlineAckThresholdMinutes: number;
}
