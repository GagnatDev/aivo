import { runAgent } from "../agent/agent.js";
import type { AgentDeps } from "../agent/deps.js";
import { transcribeVoiceMessage, type VoiceAttachment } from "../agent/transcription.js";

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
  /** Present when the message is a Discord voice message (transcribed before the turn). */
  voice?: VoiceAttachment;
}

// A voice message's transcript is persisted as the user turn's content, prefixed so the
// history (and the model) reads it as spoken — the model is then lenient with the small
// disfluencies transcription leaves in. The `stt` llm_usage row is the durable proof it
// was audio.
const VOICE_PREFIX = "🎤 (voice message) ";
// Persisted when a voice message can't be transcribed (too long / STT unavailable), so
// the conversation still records that something was sent.
const VOICE_PLACEHOLDER = "🎤 (voice message)";

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
  /**
   * The turn was abandoned mid-flight (shutdown). The inbound message is still
   * recorded, but there is no answer to send — the caller must not reply.
   */
  aborted?: boolean;
}

export interface HandleMessageOptions {
  /** Abandons the turn when it fires; the gateway passes its shutdown signal. */
  signal?: AbortSignal;
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
  opts: HandleMessageOptions = {},
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

  // Voice message: transcribe up front and run the rest of the turn on the transcript.
  // A rejection (too long) or STT failure short-circuits to a friendly reply with no LLM
  // turn — but we still record the inbound so history reflects that a note arrived.
  let voiceAlertPct: number | undefined;
  let content = msg.content;
  if (msg.voice) {
    const outcome = await transcribeVoiceMessage(deps, user.id, msg.voice);
    if (outcome.kind !== "ok") {
      await deps.messages.insert({
        conversationId: conversation.id,
        role: "user",
        content: VOICE_PLACEHOLDER,
        discordMessageId: msg.id,
      });
      return { reply: outcome.reply, conversationId: conversation.id };
    }
    // Combine any typed text with the transcript (voice notes are normally text-empty).
    content = [`${VOICE_PREFIX}${outcome.text}`, msg.content.trim()].filter(Boolean).join("\n");
    voiceAlertPct = outcome.alertPct;
  }

  await deps.messages.insert({
    conversationId: conversation.id,
    role: "user",
    content,
    discordMessageId: msg.id,
  });

  // A reply to Aivo in #youtube is digest feedback (docs/concept.md: freeform replies
  // fold into the interest profile). Captured deterministically here — the next digest
  // run folds it — and the turn still runs so the user gets a conversational response.
  if (msg.channel === "youtube" && msg.isReplyToAgent && content.trim()) {
    await deps.feedback.insert({
      userId: user.id,
      signal: "freeform",
      freeformText: content.trim(),
    });
  }

  const result = await runAgent(deps, {
    userId: user.id,
    isOwner: user.is_owner,
    conversationId: conversation.id,
    triggerMessageId: msg.id,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  // Surface whichever budget alert crossed higher — transcription may have tipped a
  // threshold before the chat turn ran.
  const alertPct =
    voiceAlertPct != null && result.alertPct != null
      ? Math.max(voiceAlertPct, result.alertPct)
      : (result.alertPct ?? voiceAlertPct);

  return {
    reply: result.reply,
    conversationId: result.conversationId,
    pendingApprovalId: result.pendingApprovalId,
    alertPct,
    ...(result.aborted ? { aborted: true } : {}),
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
