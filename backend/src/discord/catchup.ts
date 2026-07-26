import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { logger } from "../logger.js";
import type { DiscordConfig } from "./config.js";
import { isCommand } from "./commands.js";
import type { HandleMessageDeps } from "./handleMessage.js";
import { processAndReply, resolveMessageMeta, shouldRespond } from "./router.js";
import { turnKey, type TurnQueue } from "./turnQueue.js";

/** Discord's max messages per fetch request. */
const FETCH_LIMIT = 100;
/** Safety backstop on pagination so a huge backlog can't loop unbounded. */
const MAX_PAGES = 10;

/**
 * Reply to messages that arrived while Aivo was offline. Aivo only reacts to the
 * gateway's live MessageCreate events, so anything sent while the process was down
 * is never seen. On startup we take a single watermark — the last message Aivo
 * recorded anywhere, i.e. when it was last online — then scan every readable text
 * channel in the guild for messages newer than it and run each through the same
 * decision/reply path as a live message ({@link shouldRespond}/{@link processAndReply}).
 * With nothing on record there is no watermark and nothing to do. Each reply goes
 * through the gateway's shared {@link TurnQueue} so a catch-up turn can't interleave
 * with a live turn on the same conversation.
 */
export async function catchUpOnMissedMessages(
  deps: HandleMessageDeps,
  client: Client<true>,
  cfg: DiscordConfig,
  turns: TurnQueue,
  /** The gateway's shutdown signal: stop replaying the backlog once it fires. */
  signal?: AbortSignal,
): Promise<void> {
  const watermark = await deps.messages.getLatestDiscordMessageId();
  if (!watermark) return;

  const guild = await client.guilds.fetch(cfg.guildId);
  const me = await guild.members.fetchMe();
  const channels = await readableTextChannels(guild, me);

  let handled = 0;
  for (const channel of channels) {
    if (signal?.aborted) break;
    try {
      handled += await catchUpChannel(deps, channel, watermark, cfg, turns, signal);
    } catch (err) {
      logger.error({ err, channelId: channel.id }, "catch-up failed for channel");
    }
  }
  logger.info({ channels: channels.length, handled }, "catch-up complete");
}

/** Reply to every missed message in one channel; returns how many were answered. */
async function catchUpChannel(
  deps: HandleMessageDeps,
  channel: GuildTextBasedChannel,
  watermark: string,
  cfg: DiscordConfig,
  turns: TurnQueue,
  signal?: AbortSignal,
): Promise<number> {
  let handled = 0;
  for (const message of await missedSince(channel, watermark)) {
    // Shutting down: leave the rest of the backlog for the next start (the watermark
    // only advances for messages actually answered).
    if (signal?.aborted) break;
    // Skip anything already recorded (e.g. handled live during startup).
    if (await deps.messages.existsByDiscordMessageId(message.id)) continue;
    // Commands are immediate instructions — a missed one is stale, so don't replay it
    // (and never send a command through the agent loop).
    if (isCommand(message.content)) continue;
    const meta = await resolveMessageMeta(message, cfg);
    if (!shouldRespond(meta, cfg)) continue;
    await turns.run(turnKey(message.author.id, message.channelId), () =>
      processAndReply(deps, message, cfg, {
        acknowledgeIfStale: true,
        meta,
        ...(signal ? { signal } : {}),
      }),
    );
    handled += 1;
  }
  return handled;
}

/**
 * Every message in `channel` newer than `after`, oldest first. Discord's `after`
 * returns at most {@link FETCH_LIMIT} messages immediately following the cursor, so
 * we page forward — advancing the cursor to the newest id seen — until a short page
 * (or the {@link MAX_PAGES} backstop) ends the walk.
 */
async function missedSince(channel: GuildTextBasedChannel, after: string): Promise<Message[]> {
  const collected: Message[] = [];
  let cursor = after;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await channel.messages.fetch({ after: cursor, limit: FETCH_LIMIT });
    if (batch.size === 0) break;

    for (const message of batch.values()) {
      collected.push(message);
      if (BigInt(message.id) > BigInt(cursor)) cursor = message.id;
    }

    if (batch.size < FETCH_LIMIT) break;
    if (page === MAX_PAGES - 1) {
      logger.warn(
        { channelId: channel.id, cap: MAX_PAGES * FETCH_LIMIT },
        "catch-up hit the pagination backstop; older messages were not replied to",
      );
    }
  }

  return collected.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** Guild text channels and active threads whose history Aivo is allowed to read. */
async function readableTextChannels(
  guild: Guild,
  me: GuildMember,
): Promise<GuildTextBasedChannel[]> {
  const channels: GuildTextBasedChannel[] = [];
  const add = (channel: GuildTextBasedChannel): void => {
    if (canReadHistory(channel, me)) channels.push(channel);
  };

  for (const channel of (await guild.channels.fetch()).values()) {
    if (channel?.isTextBased()) add(channel);
  }
  for (const thread of (await guild.channels.fetchActiveThreads()).threads.values()) {
    add(thread);
  }
  return channels;
}

function canReadHistory(channel: GuildTextBasedChannel, me: GuildMember): boolean {
  return (
    channel
      .permissionsFor(me)
      ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]) ?? false
  );
}
