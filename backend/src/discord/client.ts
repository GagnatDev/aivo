import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import {
  handleIncomingMessage,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";

export interface DiscordGateway {
  client: Client;
  login: () => Promise<void>;
  destroy: () => Promise<void>;
  isReady: () => boolean;
}

/** Normalize a discord.js message to the plain shape the core operates on. */
function normalize(message: Message): IncomingMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.username,
    channelId: message.channelId,
    content: message.content,
  };
}

/**
 * Wire the discord.js gateway to the message core. On each guild message we
 * JIT-provision the user, persist the inbound message, reply with the ping-pong
 * stub, and persist the assistant reply linked to the sent message. Messages from
 * bots or from outside the configured guild are ignored.
 */
export function createDiscordGateway(deps: HandleMessageDeps): DiscordGateway {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ tag: ready.user.tag }, "discord gateway ready");
  });

  client.on(Events.MessageCreate, (message) => {
    void onMessage(deps, message);
  });

  client.on(Events.Error, (err) => {
    logger.error(err, "discord client error");
  });

  return {
    client,
    login: async () => {
      await client.login(env.DISCORD_BOT_TOKEN);
    },
    destroy: () => client.destroy(),
    isReady: () => client.isReady(),
  };
}

async function onMessage(deps: HandleMessageDeps, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.guildId !== env.DISCORD_GUILD_ID) return;

  try {
    const result = await handleIncomingMessage(deps, normalize(message));
    const sent = await message.reply(result.reply);
    await recordAssistantReply(deps, result.conversationId, result.reply, sent.id);
  } catch (err) {
    logger.error(err, "failed to handle discord message");
  }
}
