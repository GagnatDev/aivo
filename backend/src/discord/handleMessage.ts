import type { ConversationRepository } from "../storage/conversationRepository.js";
import type { MessageRepository } from "../storage/messageRepository.js";
import type { UserRepository } from "../storage/userRepository.js";

/**
 * The dependencies the message core needs, injected so the core stays free of
 * discord.js and is unit-testable against a real database.
 */
export interface HandleMessageDeps {
  users: UserRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  /** Discord id of the owner; flags is_owner on JIT provisioning. */
  ownerDiscordUserId: string;
}

/** A Discord message normalized to the plain shape the core operates on. */
export interface IncomingMessage {
  /** Discord message snowflake. */
  id: string;
  authorId: string;
  authorDisplayName: string | null;
  channelId: string;
  content: string;
}

export interface HandleMessageResult {
  /** The text to send back to Discord. */
  reply: string;
  /** The conversation the exchange was recorded under. */
  conversationId: string;
}

/** Build the deterministic ping-pong stub reply (no LLM in this slice). */
export function buildReply(content: string): string {
  return `🏓 pong — you said: "${content}"`;
}

/**
 * Core inbound handler: JIT-provision the user, open/update the chat conversation,
 * persist the inbound message, and compute the reply. The caller is responsible
 * for actually sending the reply to Discord and then calling
 * {@link recordAssistantReply} with the sent message's id.
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
    "chat",
    msg.channelId,
  );

  await deps.messages.insert({
    conversationId: conversation.id,
    role: "user",
    content: msg.content,
    discordMessageId: msg.id,
  });

  return { reply: buildReply(msg.content), conversationId: conversation.id };
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
