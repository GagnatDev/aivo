import { Client, Events, GatewayIntentBits, type Interaction, type Message } from "discord.js";
import { logger } from "../logger.js";
import { catchUpOnMissedMessages } from "./catchup.js";
import type { DiscordConfig } from "./config.js";
import { isCommand, runCommand } from "./commands.js";
import { recordAssistantReply, type HandleMessageDeps } from "./handleMessage.js";
import { normalize, processAndReply, resolveApproval, shouldRespond } from "./router.js";

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
export function createDiscordGateway(deps: HandleMessageDeps, cfg: DiscordConfig): DiscordGateway {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ tag: ready.user.tag }, "discord gateway ready");
    void catchUpOnMissedMessages(deps, ready, cfg).catch((err) => {
      logger.error(err, "catch-up on missed messages failed");
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void onMessage(deps, message, cfg);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void onInteraction(deps, interaction);
  });

  client.on(Events.Error, (err) => {
    logger.error(err, "discord client error");
  });

  return {
    client,
    login: async () => {
      await client.login(cfg.botToken);
    },
    destroy: () => client.destroy(),
    isReady: () => client.isReady(),
  };
}

async function onMessage(
  deps: HandleMessageDeps,
  message: Message,
  cfg: DiscordConfig,
): Promise<void> {
  if (!(await shouldRespond(message, cfg))) return;
  try {
    // Control commands (e.g. !models) are handled directly — no LLM, no cost, no gating.
    if (isCommand(message.content)) {
      const reply = await runCommand(deps, normalize(message));
      await message.reply(reply);
      return;
    }
    await processAndReply(deps, message, cfg);
  } catch (err) {
    logger.error(err, "failed to handle discord message");
    // Last resort: the agent already turns LLM failures into a friendly reply, so
    // reaching here means something else broke (DB, Discord send). Acknowledge it
    // rather than leaving the user with silence.
    try {
      await message.reply("Sorry — I ran into a problem handling that. Please try again.");
    } catch (replyErr) {
      logger.error(replyErr, "failed to send error reply");
    }
  }
}

/**
 * Handle Approve/Cancel button clicks on an approval-gate prompt. We defer the update
 * first (Discord requires an ack within 3s, and resuming the turn runs the LLM, which
 * can take longer), then edit the prompt to drop its buttons and, on approval, post
 * the answer as a follow-up and persist it.
 */
async function onInteraction(deps: HandleMessageDeps, interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  const [action, approvalId] = interaction.customId.split(":");
  if ((action !== "approve" && action !== "cancel") || !approvalId) return;

  try {
    await interaction.deferUpdate();
    const outcome = await resolveApproval(deps, {
      action,
      approvalId,
      clickerDiscordId: interaction.user.id,
    });

    if (outcome.type === "denied") {
      await interaction.followUp({ content: outcome.ephemeral, ephemeral: true });
      return;
    }

    const original = interaction.message.content;
    await interaction.editReply({
      content: `${original}\n\n*${outcome.promptUpdate}*`,
      components: [],
    });

    if (outcome.type === "approved") {
      const sent = await interaction.followUp({ content: outcome.followUpReply });
      await recordAssistantReply(deps, outcome.conversationId, outcome.followUpReply, sent.id);
    }
  } catch (err) {
    logger.error(err, "failed to handle button interaction");
    try {
      await interaction.followUp({
        content: "Sorry — I ran into a problem with that. Please try again.",
        ephemeral: true,
      });
    } catch (replyErr) {
      logger.error(replyErr, "failed to send interaction error reply");
    }
  }
}
