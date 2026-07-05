import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { Channel } from "../db/schema.enums.js";

export interface ConversationRow {
  id: string;
  user_id: string;
  channel: Channel;
  discord_channel_id: string | null;
  created_at: Date;
  last_message_at: Date;
}

const CONVERSATION_COLUMNS = [
  "id",
  "user_id",
  "channel",
  "discord_channel_id",
  "created_at",
  "last_message_at",
] as const;

export class ConversationRepository {
  constructor(private readonly db: Db) {}

  /**
   * Get the running conversation for a (user, channel), creating it on first use.
   * Idempotent via the UNIQUE (user_id, channel) constraint; every call bumps
   * `last_message_at` and refreshes the linked Discord channel id.
   */
  async getOrCreate(
    userId: string,
    channel: Channel,
    discordChannelId: string | null,
  ): Promise<ConversationRow> {
    const row = await this.db
      .insertInto("conversations")
      .values({
        user_id: userId,
        channel,
        discord_channel_id: discordChannelId,
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "channel"]).doUpdateSet({
          discord_channel_id: discordChannelId,
          last_message_at: sql`now()`,
        }),
      )
      .returning(CONVERSATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** A user's conversations, most recently active first (dashboard A-1). */
  listForUser(userId: string): Promise<ConversationRow[]> {
    return this.db
      .selectFrom("conversations")
      .select(CONVERSATION_COLUMNS)
      .where("user_id", "=", userId)
      .orderBy("last_message_at", "desc")
      .execute();
  }

  /** One conversation, scoped by user so the API can't serve another user's thread. */
  findByIdForUser(id: string, userId: string): Promise<ConversationRow | undefined> {
    return this.db
      .selectFrom("conversations")
      .select(CONVERSATION_COLUMNS)
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }
}
