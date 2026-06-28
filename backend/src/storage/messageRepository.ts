import type { Db } from "../db/kysely.js";
import type { MessageRole } from "../db/schema.js";

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  discord_message_id: string | null;
  content: string | null;
}

const MESSAGE_COLUMNS = [
  "id",
  "conversation_id",
  "role",
  "discord_message_id",
  "content",
] as const;

export interface InsertMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string | null;
  discordMessageId?: string | null;
}

export class MessageRepository {
  constructor(private readonly db: Db) {}

  async insert(input: InsertMessageInput): Promise<MessageRow> {
    const row = await this.db
      .insertInto("messages")
      .values({
        conversation_id: input.conversationId,
        role: input.role,
        content: input.content,
        discord_message_id: input.discordMessageId ?? null,
      })
      .returning(MESSAGE_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Messages in a conversation, oldest first. */
  listByConversation(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .selectFrom("messages")
      .select(MESSAGE_COLUMNS)
      .where("conversation_id", "=", conversationId)
      .orderBy("created_at", "asc")
      .execute();
  }
}
