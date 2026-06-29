import type { Message } from "discord.js";
import { env } from "../config/env.js";
import {
  handleIncomingMessage,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";

/** Normalize a discord.js message to the plain shape the core operates on. */
export function normalize(message: Message): IncomingMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.username,
    channelId: message.channelId,
    content: message.content,
  };
}

async function isReplyToAivo(message: Message): Promise<boolean> {
  const refId = message.reference?.messageId;
  if (!refId) return false;
  try {
    const ref = await message.channel.messages.fetch(refId);
    return ref.author.id === message.client.user?.id;
  } catch {
    return false;
  }
}

/**
 * Whether Aivo should reply to a message. Bots and other guilds are ignored. In
 * the home channel Aivo answers everything; elsewhere only when mentioned or when
 * the message replies to one of Aivo's own messages. Shared by the live gateway
 * (discord/client.ts) and the offline catch-up (discord/catchup.ts) so both apply
 * identical rules.
 */
export async function shouldRespond(message: Message): Promise<boolean> {
  if (message.author.bot) return false;
  if (message.guildId !== env.DISCORD_GUILD_ID) return false;

  if (message.channelId !== env.DISCORD_HOME_CHANNEL_ID) {
    const mentioned = message.mentions.has(message.client.user!);
    if (!mentioned && !(await isReplyToAivo(message))) return false;
  }
  return true;
}

export interface ProcessOptions {
  /**
   * When set, a reply to a message older than OFFLINE_ACK_THRESHOLD_MINUTES is
   * prefixed with a short note that Aivo was offline. Used by catch-up so a late
   * reply is explained; the live path leaves it off.
   */
  acknowledgeIfStale?: boolean;
}

/**
 * Run a message through the core, send the reply to Discord, and persist it. The
 * caller is responsible for having checked {@link shouldRespond} first.
 */
export async function processAndReply(
  deps: HandleMessageDeps,
  message: Message,
  opts: ProcessOptions = {},
): Promise<void> {
  const result = await handleIncomingMessage(deps, normalize(message));

  let reply = result.reply;
  if (opts.acknowledgeIfStale) {
    const ageMs = Date.now() - message.createdTimestamp;
    if (ageMs >= env.OFFLINE_ACK_THRESHOLD_MINUTES * 60_000) {
      reply = `${offlineAck(ageMs)}\n\n${reply}`;
    }
  }

  const sent = await message.reply(reply);
  await recordAssistantReply(deps, result.conversationId, reply, sent.id);
}

/** A short, dry note prefixed to late replies so the delay is explained. */
function offlineAck(ageMs: number): string {
  return `*(I was offline for ${humanizeDuration(ageMs)} — catching up now.)*`;
}

function humanizeDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
