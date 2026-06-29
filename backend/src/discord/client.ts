import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { catchUpOnMissedMessages } from "./catchup.js";
import type { HandleMessageDeps } from "./handleMessage.js";
import { processAndReply, shouldRespond } from "./router.js";

export interface DiscordGateway {
  client: Client;
  login: () => Promise<void>;
  destroy: () => Promise<void>;
  isReady: () => boolean;
}

/**
 * Wire the discord.js gateway to the message core. On each guild message we
 * JIT-provision the user, persist the inbound message, reply with the ping-pong
 * stub, and persist the assistant reply linked to the sent message. Messages from
 * bots or from outside the configured guild are ignored. On connect we also catch
 * up on anything sent while the process was offline (see discord/catchup.ts).
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
    void catchUpOnMissedMessages(deps, ready).catch((err) => {
      logger.error(err, "catch-up on missed messages failed");
    });
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
  if (!(await shouldRespond(message))) return;
  try {
    await processAndReply(deps, message);
  } catch (err) {
    logger.error(err, "failed to handle discord message");
  }
}
