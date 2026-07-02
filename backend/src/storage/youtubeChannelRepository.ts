import type { Db } from "../db/kysely.js";

export interface YoutubeChannelRow {
  id: string;
  title: string;
  thumbnail_url: string | null;
  subscribed: boolean;
  muted: boolean;
}

const CHANNEL_COLUMNS = ["id", "title", "thumbnail_url", "subscribed", "muted"] as const;

export interface SubscribedChannelInput {
  id: string;
  title: string;
  thumbnailUrl: string | null;
}

/**
 * Cache of the single connected account's subscribed channels. `syncSubscriptions`
 * reconciles the cache against the full list from the YouTube API: channels in the
 * list are upserted as subscribed, cached channels missing from it are flipped to
 * unsubscribed (kept — old videos/digest_items still reference them). `muted` is
 * user feedback ("stop showing me X channel") and is never touched by a sync.
 */
export class YoutubeChannelRepository {
  constructor(private readonly db: Db) {}

  /** Reconcile the cache against the account's full current subscription list. */
  async syncSubscriptions(channels: SubscribedChannelInput[], now: Date): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (channels.length > 0) {
        await trx
          .insertInto("youtube_channels")
          .values(
            channels.map((c) => ({
              id: c.id,
              title: c.title,
              thumbnail_url: c.thumbnailUrl,
              subscribed: true,
              subscribed_at: now,
              last_seen_at: now,
            })),
          )
          .onConflict((oc) =>
            oc.column("id").doUpdateSet((eb) => ({
              title: eb.ref("excluded.title"),
              thumbnail_url: eb.ref("excluded.thumbnail_url"),
              subscribed: true,
              unsubscribed_at: null,
              last_seen_at: now,
            })),
          )
          .execute();
      }
      let unsubscribe = trx
        .updateTable("youtube_channels")
        .set({ subscribed: false, unsubscribed_at: now })
        .where("subscribed", "=", true);
      if (channels.length > 0) {
        unsubscribe = unsubscribe.where(
          "id",
          "not in",
          channels.map((c) => c.id),
        );
      }
      await unsubscribe.execute();
    });
  }

  /** Channels whose new videos feed the digest: still subscribed and not muted. */
  listActive(): Promise<YoutubeChannelRow[]> {
    return this.db
      .selectFrom("youtube_channels")
      .select(CHANNEL_COLUMNS)
      .where("subscribed", "=", true)
      .where("muted", "=", false)
      .orderBy("title")
      .execute();
  }

  /** Mute/unmute a channel (from feedback); muted channels are skipped by ingest. */
  async setMuted(id: string, muted: boolean): Promise<YoutubeChannelRow | undefined> {
    return this.db
      .updateTable("youtube_channels")
      .set({ muted })
      .where("id", "=", id)
      .returning(CHANNEL_COLUMNS)
      .executeTakeFirst();
  }

  /** Case-insensitive title lookup, for resolving "mute channel X" from chat. */
  findByTitle(title: string): Promise<YoutubeChannelRow | undefined> {
    return this.db
      .selectFrom("youtube_channels")
      .select(CHANNEL_COLUMNS)
      .where("title", "ilike", title)
      .executeTakeFirst();
  }
}
