import { Client, Events, GatewayIntentBits, type Interaction, type Message } from "discord.js";
import { logger } from "../logger.js";
import { catchUpOnMissedMessages } from "./catchup.js";
import type { DiscordConfig } from "./config.js";
import { messages } from "../i18n/index.js";
import { isCommand, runCommand } from "./commands.js";
import { resolveFeedbackClick } from "./feedback.js";
import { resolveReminderClick } from "./reminderButtons.js";
import {
  languageForDiscordUser,
  recordAssistantReply,
  type HandleMessageDeps,
} from "./handleMessage.js";
import {
  normalize,
  processAndReply,
  resolveApproval,
  resolveMessageMeta,
  shouldRespond,
} from "./router.js";
import { TurnQueue, turnKey } from "./turnQueue.js";
import { withTyping } from "./typing.js";

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
 * Turns are serialized per conversation through a shared {@link TurnQueue} so two
 * quick messages (or a live message racing catch-up) can't interleave.
 */
export function createDiscordGateway(deps: HandleMessageDeps, cfg: DiscordConfig): DiscordGateway {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const turns = new TurnQueue();
  // Aborted by `destroy()`, i.e. by the process's graceful shutdown. Turns in flight
  // stop between round-trips (and cancel the in-flight LLM call) instead of being cut
  // off mid-request when the process exits; queued turns never start.
  const shutdown = new AbortController();

  client.once(Events.ClientReady, (ready) => {
    logger.info({ tag: ready.user.tag }, "discord gateway ready");
    void catchUpOnMissedMessages(deps, ready, cfg, turns, shutdown.signal).catch((err) => {
      logger.error(err, "catch-up on missed messages failed");
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void onMessage(deps, message, cfg, turns, shutdown.signal);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void onInteraction(deps, interaction, shutdown.signal);
  });

  client.on(Events.Error, (err) => {
    logger.error(err, "discord client error");
  });

  return {
    client,
    login: async () => {
      await client.login(cfg.botToken);
    },
    destroy: async () => {
      shutdown.abort();
      await client.destroy();
    },
    isReady: () => client.isReady(),
  };
}

async function onMessage(
  deps: HandleMessageDeps,
  message: Message,
  cfg: DiscordConfig,
  turns: TurnQueue,
  signal: AbortSignal,
): Promise<void> {
  const meta = await resolveMessageMeta(message);
  if (!shouldRespond(meta, cfg)) return;
  try {
    // Control commands (e.g. !models) are handled directly — no LLM, no cost, no gating.
    if (isCommand(message.content)) {
      const reply = await runCommand(deps, normalize(message));
      await message.reply(reply);
      return;
    }
    // Queued per conversation: a second message from the same user in the same channel
    // waits for the previous turn, so its context includes that turn's reply.
    await turns.run(turnKey(message.author.id, message.channelId), () =>
      processAndReply(deps, message, cfg, { meta, signal }),
    );
  } catch (err) {
    logger.error(err, "failed to handle discord message");
    // Last resort: the agent already turns LLM failures into a friendly reply, so
    // reaching here means something else broke (DB, Discord send). Acknowledge it
    // rather than leaving the user with silence.
    try {
      const lang = await languageForDiscordUser(deps, message.author.id);
      await message.reply(messages(lang).errors.handlingProblem);
    } catch (replyErr) {
      logger.error(replyErr, "failed to send error reply");
    }
  }
}

/**
 * Handle button clicks: digest feedback buttons (`fb:*`, acknowledged ephemerally and
 * folded into the interest profile by the next run), reminder snooze buttons (`rem:*`,
 * re-arming the reminder), and Approve/Cancel clicks on an approval-gate prompt. For
 * approvals we defer the update first (Discord requires an ack within 3s, and resuming
 * the turn runs the LLM, which can take longer), then edit the prompt to drop its
 * buttons and, on approval, post the answer as a follow-up and persist it.
 */
async function onInteraction(
  deps: HandleMessageDeps,
  interaction: Interaction,
  signal: AbortSignal,
): Promise<void> {
  if (!interaction.isButton()) return;

  try {
    const click = {
      customId: interaction.customId,
      clickerDiscordId: interaction.user.id,
      clickerDisplayName: interaction.user.username,
    };
    const ephemeralAck =
      (await resolveFeedbackClick(deps, click)) ?? (await resolveReminderClick(deps, click));
    if (ephemeralAck) {
      await interaction.reply({ content: ephemeralAck.ack, ephemeral: true });
      return;
    }
  } catch (err) {
    logger.error(err, "failed to handle feedback/reminder button");
    return;
  }

  const [action, approvalId] = interaction.customId.split(":");
  if ((action !== "approve" && action !== "cancel") || !approvalId) return;

  try {
    await interaction.deferUpdate();
    const channel = interaction.channel?.isSendable() ? interaction.channel : null;
    const resolve = () =>
      resolveApproval(deps, {
        action,
        approvalId,
        clickerDiscordId: interaction.user.id,
        signal,
      });
    const outcome = action === "approve" ? await withTyping(channel, resolve) : await resolve();

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
      const lang = await languageForDiscordUser(deps, interaction.user.id);
      await interaction.followUp({
        content: messages(lang).errors.interactionProblem,
        ephemeral: true,
      });
    } catch (replyErr) {
      logger.error(replyErr, "failed to send interaction error reply");
    }
  }
}
