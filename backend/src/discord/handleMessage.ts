import { runAgent } from "../agent/agent.js";
import type { AgentDeps } from "../agent/deps.js";

/**
 * The dependencies the message core needs, injected so the core stays free of
 * discord.js and is unit-testable against a real database + a fake LLM provider. This
 * is the full AgentDeps (repos + LLM provider + owner id).
 */
export type HandleMessageDeps = AgentDeps;

/** A Discord message normalized to the plain shape the core operates on. */
export interface IncomingMessage {
  /** Discord message snowflake. */
  id: string;
  authorId: string;
  authorDisplayName: string | null;
  channelId: string;
  content: string;
  /** Which capability channel the message arrived in (default `chat`). */
  channel?: "chat" | "youtube";
  /** True when the message replies to one of Aivo's own messages (digest feedback). */
  isReplyToAgent?: boolean;
}

export interface HandleMessageResult {
  /** The text to send back to Discord. */
  reply: string;
  /** The conversation the exchange was recorded under. */
  conversationId: string;
  /**
   * Set when the turn is gated pending the user's approval — the caller should post
   * the reply with Approve/Cancel buttons rather than as a final answer.
   */
  pendingApprovalId?: string;
  /** Set when a budget alert threshold was newly crossed this turn. */
  alertPct?: number;
}

/**
 * Core inbound handler: JIT-provision the user, open/update the chat conversation,
 * persist the inbound message, then run the LLM-backed agent. The caller is
 * responsible for sending the reply to Discord and then calling
 * {@link recordAssistantReply} with the sent message's id (unless the turn is gated).
 */
export async function handleIncomingMessage(
  deps: HandleMessageDeps,
  msg: IncomingMessage,
): Promise<HandleMessageResult> {
  const user = await deps.users.upsertByDiscordId({
    discordUserId: msg.authorId,
    displayName: msg.authorDisplayName,
    isOwner: msg.authorId === deps.ownerDiscordUserId,
  });

  const conversation = await deps.conversations.getOrCreate(
    user.id,
    msg.channel ?? "chat",
    msg.channelId,
  );

  await deps.messages.insert({
    conversationId: conversation.id,
    role: "user",
    content: msg.content,
    discordMessageId: msg.id,
  });

  // A reply to Aivo in #youtube is digest feedback (docs/concept.md: freeform replies
  // fold into the interest profile). Captured deterministically here — the next digest
  // run folds it — and the turn still runs so the user gets a conversational response.
  if (msg.channel === "youtube" && msg.isReplyToAgent && msg.content.trim()) {
    await deps.feedback.insert({
      userId: user.id,
      signal: "freeform",
      freeformText: msg.content.trim(),
    });
  }

  const result = await runAgent(deps, {
    userId: user.id,
    isOwner: user.is_owner,
    conversationId: conversation.id,
    triggerMessageId: msg.id,
  });

  return {
    reply: result.reply,
    conversationId: result.conversationId,
    pendingApprovalId: result.pendingApprovalId,
    alertPct: result.alertPct,
  };
}

/** Persist the assistant reply after it has been sent to Discord. */
export async function recordAssistantReply(
  deps: HandleMessageDeps,
  conversationId: string,
  reply: string,
  discordMessageId: string | null,
): Promise<void> {
  await deps.messages.insert({
    conversationId,
    role: "assistant",
    content: reply,
    discordMessageId,
  });
}
