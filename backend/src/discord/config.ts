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
  /** The single guild Aivo serves; messages from other guilds are ignored. DMs are
   * answered only when the author is a member of this guild. `DISCORD_GUILD_ID`. */
  guildId: string;
  /** In this channel Aivo answers everything; elsewhere in the guild only on
   * mention/reply. DMs are always open (for home-guild members). `DISCORD_HOME_CHANNEL_ID`. */
  homeChannelId: string;
  /** The #youtube channel: digest delivery + feedback; Aivo answers everything here
   * too. Null until configured — the digest then falls back to the home channel.
   * `DISCORD_YOUTUBE_CHANNEL_ID`. */
  youtubeChannelId: string | null;
  /** A caught-up reply to a message older than this many minutes is prefixed with an
   * offline note. `OFFLINE_ACK_THRESHOLD_MINUTES`. */
  offlineAckThresholdMinutes: number;
}
