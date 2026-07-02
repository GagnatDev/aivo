import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message } from "discord.js";
import { resumeApprovedAgent } from "../agent/agent.js";
import type { DiscordConfig } from "./config.js";
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
 * the home channel Aivo answers everything; elsewhere only when mentioned or when
 * the message replies to one of Aivo's own messages. A pure function of the
 * normalized {@link MessageMeta}, shared by the live gateway (discord/client.ts) and
 * the offline catch-up (discord/catchup.ts) so both apply identical rules.
 */
export function shouldRespond(meta: MessageMeta, cfg: DiscordConfig): boolean {
  if (meta.isBot) return false;
  if (meta.guildId !== cfg.guildId) return false;

  if (meta.channelId !== cfg.homeChannelId) {
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
  const result = await handleIncomingMessage(deps, normalize(message));

  // Gated turn: post the confirmation with Approve/Cancel buttons and wait — the
  // button handler (discord/client.ts) resumes the turn. No assistant reply yet.
  if (result.pendingApprovalId) {
    const sent = await message.reply({
      content: result.reply,
      components: [approvalButtons(result.pendingApprovalId)],
    });
    await deps.pendingApprovals.setPromptMessageId(result.pendingApprovalId, sent.id);
    return;
  }

  let reply = result.reply;
  if (result.alertPct) reply = `${reply}\n\n${budgetAlert(result.alertPct)}`;
  if (opts.acknowledgeIfStale) {
    const ageMs = deps.clock.now().getTime() - message.createdTimestamp;
    if (ageMs >= cfg.offlineAckThresholdMinutes * 60_000) {
      reply = `${offlineAck(ageMs)}\n\n${reply}`;
    }
  }

  const sent = await message.reply(reply);
  await recordAssistantReply(deps, result.conversationId, reply, sent.id);
}

/** The Approve/Cancel button row attached to an approval-gate prompt. */
export function approvalButtons(approvalId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${approvalId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel:${approvalId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

function budgetAlert(pct: number): string {
  return `*(Budget: you've used about ${pct}% of this month's ceiling.)*`;
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
  params: { action: "approve" | "cancel"; approvalId: string; clickerDiscordId: string },
): Promise<ApprovalOutcome> {
  const approval = await deps.pendingApprovals.findById(params.approvalId);
  if (!approval) return { type: "expired", promptUpdate: "This request is no longer available." };

  const requester = await deps.users.findById(approval.user_id);
  if (requester?.discord_user_id !== params.clickerDiscordId) {
    return {
      type: "denied",
      ephemeral: "Only the person who made this request can respond to it.",
    };
  }

  if (params.action === "cancel") {
    const cancelled = await deps.pendingApprovals.resolveIfPending(params.approvalId, "cancelled");
    if (!cancelled) return { type: "expired", promptUpdate: "This request already expired." };
    return { type: "cancelled", promptUpdate: "Cancelled — I didn't run it." };
  }

  const approved = await deps.pendingApprovals.resolveIfPending(params.approvalId, "approved");
  if (!approved) return { type: "expired", promptUpdate: "This request expired — just ask again." };

  const result = await resumeApprovedAgent(deps, params.approvalId);
  if (!result)
    return { type: "expired", promptUpdate: "I couldn't pick that request back up — ask again." };
  // A gated turn is the likeliest to push spend over a threshold, so fold any alert
  // it crossed into the follow-up rather than dropping it.
  const followUpReply = result.alertPct
    ? `${result.reply}\n\n${budgetAlert(result.alertPct)}`
    : result.reply;
  return {
    type: "approved",
    promptUpdate: "Approved.",
    followUpReply,
    conversationId: result.conversationId,
  };
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
