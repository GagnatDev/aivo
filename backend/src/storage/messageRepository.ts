import { sql } from "kysely";
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

  /**
   * The highest Discord message id Aivo has recorded, or null if none. This is the
   * offline catch-up watermark: it marks the last message Aivo handled before going
   * down — i.e. roughly when it was last online. Because Discord snowflakes are
   * globally monotonic in time, anything newer than it (in any channel) was sent
   * during the downtime, so it is a valid "after" cursor for every channel. Ordered
   * by the snowflake as a bigint, since ids are not lexically comparable across
   * widths.
   */
  async getLatestDiscordMessageId(): Promise<string | null> {
    const row = await this.db
      .selectFrom("messages")
      .select("discord_message_id")
      .where("discord_message_id", "is not", null)
      .orderBy(sql<string>`discord_message_id::bigint`, "desc")
      .limit(1)
      .executeTakeFirst();
    return row?.discord_message_id ?? null;
  }

  /** Whether a message with this Discord id has already been recorded. */
  async existsByDiscordMessageId(discordMessageId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("messages")
      .select("id")
      .where("discord_message_id", "=", discordMessageId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }
}
