import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface YoutubeAccountRow {
  id: number;
  youtube_channel_id: string | null;
  title: string | null;
  connected_by_user_id: string | null;
  subscriptions_synced_at: Date | null;
  videos_polled_at: Date | null;
}

const ACCOUNT_COLUMNS = [
  "id",
  "youtube_channel_id",
  "title",
  "connected_by_user_id",
  "subscriptions_synced_at",
  "videos_polled_at",
] as const;

/**
 * The singleton row for the one owner-connected YouTube account (docs/data-model.md).
 * Metadata + sync watermarks only — the OAuth refresh token lives in the deployment
 * secrets, never here. `id` is CHECK-constrained to 1, so getOrCreate is naturally
 * idempotent.
 */
export class YoutubeAccountRepository {
  constructor(private readonly db: Db) {}

  /** Read the singleton without creating it — undefined means "never connected". */
  find(): Promise<YoutubeAccountRow | undefined> {
    return this.db
      .selectFrom("youtube_account")
      .select(ACCOUNT_COLUMNS)
      .where("id", "=", 1)
      .executeTakeFirst();
  }

  /** The singleton row, created empty on first use. */
  async getOrCreate(): Promise<YoutubeAccountRow> {
    return this.db
      .insertInto("youtube_account")
      .values({ id: 1 })
      .onConflict((oc) => oc.column("id").doUpdateSet({ updated_at: sql`now()` }))
      .returning(ACCOUNT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Record who connected which channel (set once after the OAuth handshake). */
  async setIdentity(input: {
    youtubeChannelId: string;
    title: string | null;
    connectedByUserId: string | null;
  }): Promise<YoutubeAccountRow> {
    await this.getOrCreate();
    return this.db
      .updateTable("youtube_account")
      .set({
        youtube_channel_id: input.youtubeChannelId,
        title: input.title,
        connected_by_user_id: input.connectedByUserId,
        updated_at: sql`now()`,
      })
      .where("id", "=", 1)
      .returning(ACCOUNT_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Advance the subscription-list refresh watermark. */
  async markSubscriptionsSynced(at: Date): Promise<void> {
    await this.getOrCreate();
    await this.db
      .updateTable("youtube_account")
      .set({ subscriptions_synced_at: at, updated_at: sql`now()` })
      .where("id", "=", 1)
      .execute();
  }

  /** Advance the new-video poll watermark. */
  async markVideosPolled(at: Date): Promise<void> {
    await this.getOrCreate();
    await this.db
      .updateTable("youtube_account")
      .set({ videos_polled_at: at, updated_at: sql`now()` })
      .where("id", "=", 1)
      .execute();
  }
}
