import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type Message,
} from "discord.js";
import { resumeApprovedAgent } from "../agent/agent.js";
import type { VoiceAttachment } from "../agent/transcription.js";
import { type Language, messages } from "../i18n/index.js";
import { logger } from "../logger.js";
import type { DiscordConfig } from "./config.js";
import {
  handleIncomingMessage,
  languageForDiscordUser,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";
import { withTyping } from "./typing.js";

/**
 * Pull the voice-message payload off a Discord message, or null if it isn't one. Discord
 * flags voice messages with `IsVoiceMessage` and attaches exactly one audio file carrying
 * its duration and byte size, so the caps can be checked before any download. This is the
 * only place discord.js attachment shapes are read; the result is plain data.
 */
function extractVoice(message: Message): VoiceAttachment | undefined {
  if (!message.flags.has(MessageFlags.IsVoiceMessage)) return undefined;
  const a = message.attachments.first();
  if (!a) return undefined;
  return {
    url: a.url,
    contentType: a.contentType ?? "audio/ogg",
    durationSecs: a.duration ?? 0,
    sizeBytes: a.size,
    filename: a.name ?? "voice-message.ogg",
  };
}

/** Normalize a discord.js message to the plain shape the core operates on. */
export function normalize(message: Message): IncomingMessage {
  const voice = extractVoice(message);
  return {
    id: message.id,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.username,
    channelId: message.channelId,
    content: message.content,
    ...(voice ? { voice } : {}),
  };
}

/**
 * The routing facts {@link shouldRespond} needs, extracted from a discord.js `Message`
 * so the policy itself stays a pure, synchronous function. Resolving these (including
 * the async referenced-message fetch) is the gateway's job — see
 * {@link resolveMessageMeta} — which keeps the subtle routing rules unit-testable with
 * plain objects and zero discord.js mocks.
 */
export interface MessageMeta {
  /** True for messages authored by any bot (including Aivo itself). */
  isBot: boolean;
  /** The guild the message was sent in, or null for DMs. */
  guildId: string | null;
  /** The channel the message was sent in. */
  channelId: string;
  /** True when the message mentions Aivo. */
  mentionsMe: boolean;
  /** True when the message is a reply to one of Aivo's own messages. */
  referencedMessageAuthorIsMe: boolean;
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
 * Extract the routing facts from a discord.js message, performing the async
 * referenced-message fetch. This is the only transport-coupled part of the routing
 * decision; the policy in {@link shouldRespond} runs on the plain result.
 */
export async function resolveMessageMeta(message: Message): Promise<MessageMeta> {
  const me = message.client.user;
  return {
    isBot: message.author.bot,
    guildId: message.guildId,
    channelId: message.channelId,
    mentionsMe: me ? message.mentions.has(me) : false,
    referencedMessageAuthorIsMe: await isReplyToAivo(message),
  };
}

/**
 * Whether Aivo should reply to a message. Bots and other guilds are ignored. In
 * the home channel and the #youtube channel (digest + feedback) Aivo answers
 * everything; elsewhere only when mentioned or when the message replies to one of
 * Aivo's own messages. A pure function of the normalized {@link MessageMeta}, shared
 * by the live gateway (discord/client.ts) and the offline catch-up
 * (discord/catchup.ts) so both apply identical rules.
 */
export function shouldRespond(meta: MessageMeta, cfg: DiscordConfig): boolean {
  if (meta.isBot) return false;
  if (meta.guildId !== cfg.guildId) return false;

  const openChannel =
    meta.channelId === cfg.homeChannelId || meta.channelId === cfg.youtubeChannelId;
  if (!openChannel) {
    if (!meta.mentionsMe && !meta.referencedMessageAuthorIsMe) return false;
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
  /**
   * The routing facts the caller already resolved for {@link shouldRespond} (avoids
   * re-fetching the referenced message). Needed to recognize a #youtube reply to Aivo
   * as digest feedback.
   */
  meta?: MessageMeta;
  /**
   * Abandons the turn when it fires (the gateway's shutdown signal). An abandoned turn
   * sends nothing: the user asked a question and is getting no answer, so a stray
   * half-reply arriving as the process exits would only confuse.
   */
  signal?: AbortSignal;
}

/**
 * Run a message through the core, send the reply to Discord, and persist it. The
 * caller is responsible for having checked {@link shouldRespond} first.
 */
export async function processAndReply(
  deps: HandleMessageDeps,
  message: Message,
  cfg: DiscordConfig,
  opts: ProcessOptions = {},
): Promise<void> {
  const channel = message.channel.isSendable() ? message.channel : null;
  await withTyping(channel, async () => {
    const isYoutube = cfg.youtubeChannelId !== null && message.channelId === cfg.youtubeChannelId;
    const result = await handleIncomingMessage(
      deps,
      {
        ...normalize(message),
        channel: isYoutube ? "youtube" : "chat",
        isReplyToAgent: opts.meta?.referencedMessageAuthorIsMe ?? false,
      },
      opts.signal ? { signal: opts.signal } : {},
    );

    // Cancelled mid-turn (shutdown): the inbound message is recorded, but there's no
    // answer — say nothing rather than sending a stub the user didn't ask for.
    if (result.aborted) {
      logger.info({ messageId: message.id }, "turn abandoned; no reply sent");
      return;
    }

    // The LLM reply is already in the user's language (system-prompt directive); the
    // notes and button labels below are the verbatim bits, so resolve the preference.
    const lang = await languageForDiscordUser(deps, message.author.id);

    // Gated turn: post the confirmation with Approve/Cancel buttons and wait — the
    // button handler (discord/client.ts) resumes the turn. No assistant reply yet.
    if (result.pendingApprovalId) {
      const sent = await message.reply({
        content: result.reply,
        components: [approvalButtons(result.pendingApprovalId, lang)],
      });
      await deps.pendingApprovals.setPromptMessageId(result.pendingApprovalId, sent.id);
      return;
    }

    let reply = result.reply;
    if (result.alertPct) reply = `${reply}\n\n${budgetAlert(result.alertPct, lang)}`;
    if (opts.acknowledgeIfStale) {
      const ageMs = deps.clock.now().getTime() - message.createdTimestamp;
      if (ageMs >= cfg.offlineAckThresholdMinutes * 60_000) {
        reply = `${offlineAck(ageMs, lang)}\n\n${reply}`;
      }
    }

    const sent = await message.reply(reply);
    await recordAssistantReply(deps, result.conversationId, reply, sent.id);
  });
}

/** The Approve/Cancel button row attached to an approval-gate prompt. */
export function approvalButtons(
  approvalId: string,
  lang: Language,
): ActionRowBuilder<ButtonBuilder> {
  const a = messages(lang).approval;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${approvalId}`)
      .setLabel(a.approve)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel:${approvalId}`)
      .setLabel(a.cancel)
      .setStyle(ButtonStyle.Secondary),
  );
}

function budgetAlert(pct: number, lang: Language): string {
  return messages(lang).budget.alert(pct);
}

/** The result of acting on an Approve/Cancel button click. */
export type ApprovalOutcome =
  | { type: "denied"; ephemeral: string }
  | { type: "expired"; promptUpdate: string }
  | { type: "cancelled"; promptUpdate: string }
  | { type: "approved"; promptUpdate: string; followUpReply: string; conversationId: string };

/**
 * Resolve an Approve/Cancel button click against the durable pending-approval row.
 * Discord-thin (no interaction object) so it can be unit-tested: the caller applies
 * the returned outcome to the interaction. Only the original requester may respond;
 * a row that is no longer pending (double-click / swept-expired) reports `expired`.
 */
export async function resolveApproval(
  deps: HandleMessageDeps,
  params: {
    action: "approve" | "cancel";
    approvalId: string;
    clickerDiscordId: string;
    /** Abandons the resumed turn when it fires (the gateway's shutdown signal). */
    signal?: AbortSignal;
  },
): Promise<ApprovalOutcome> {
  // Outcomes are shown to the clicker, so localize in their language.
  const lang = await languageForDiscordUser(deps, params.clickerDiscordId);
  const a = messages(lang).approval;

  const approval = await deps.pendingApprovals.findById(params.approvalId);
  if (!approval) return { type: "expired", promptUpdate: a.noLongerAvailable };

  const requester = await deps.users.findById(approval.user_id);
  if (requester?.discord_user_id !== params.clickerDiscordId) {
    return { type: "denied", ephemeral: a.onlyRequester };
  }

  if (params.action === "cancel") {
    const cancelled = await deps.pendingApprovals.resolveIfPending(params.approvalId, "cancelled");
    if (!cancelled) return { type: "expired", promptUpdate: a.alreadyExpired };
    return { type: "cancelled", promptUpdate: a.cancelled };
  }

  const approved = await deps.pendingApprovals.resolveIfPending(params.approvalId, "approved");
  if (!approved) return { type: "expired", promptUpdate: a.expiredAskAgain };

  const result = await resumeApprovedAgent(
    deps,
    params.approvalId,
    params.signal ? { signal: params.signal } : {},
  );
  if (!result) return { type: "expired", promptUpdate: a.couldntPickUp };
  // Abandoned mid-run (shutdown): the approval is already marked approved, so report it
  // as no-longer-available rather than posting an empty follow-up.
  if (result.aborted) {
    return { type: "expired", promptUpdate: a.couldntFinish };
  }
  // A gated turn is the likeliest to push spend over a threshold, so fold any alert
  // it crossed into the follow-up rather than dropping it.
  const followUpReply = result.alertPct
    ? `${result.reply}\n\n${budgetAlert(result.alertPct, lang)}`
    : result.reply;
  return {
    type: "approved",
    promptUpdate: a.approved,
    followUpReply,
    conversationId: result.conversationId,
  };
}

/** A short, dry note prefixed to late replies so the delay is explained. */
function offlineAck(ageMs: number, lang: Language): string {
  return messages(lang).budget.offlineAck(humanizeDuration(ageMs, lang));
}

function humanizeDuration(ms: number, lang: Language): string {
  const b = messages(lang).budget;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return b.minutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return b.hours(hours);
  return b.days(Math.round(hours / 24));
}
