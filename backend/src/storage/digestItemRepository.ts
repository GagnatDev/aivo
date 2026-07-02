import type { Db } from "../db/kysely.js";
import type { DigestItemKind } from "../db/schema.enums.js";

export interface DigestItemRow {
  id: string;
  digest_id: string;
  video_id: string;
  kind: DigestItemKind;
  rank: number | null;
  reason: string | null;
  confidence: number | null;
}

const ITEM_COLUMNS = [
  "id",
  "digest_id",
  "video_id",
  "kind",
  "rank",
  "reason",
  "confidence",
] as const;

export interface InsertDigestItemInput {
  videoId: string;
  kind: DigestItemKind;
  rank?: number | null;
  reason?: string | null;
  confidence?: number | null;
}

/** A digest run's entries: ranked picks plus the rejected list with reasons. */
export class DigestItemRepository {
  constructor(private readonly db: Db) {}

  async insertMany(digestId: string, items: InsertDigestItemInput[]): Promise<DigestItemRow[]> {
    if (items.length === 0) return [];
    return this.db
      .insertInto("digest_items")
      .values(
        items.map((i) => ({
          digest_id: digestId,
          video_id: i.videoId,
          kind: i.kind,
          rank: i.rank ?? null,
          reason: i.reason ?? null,
          confidence: i.confidence ?? null,
        })),
      )
      .returning(ITEM_COLUMNS)
      .execute();
  }

  /** All items of a digest: picks (by rank) first, then rejects. */
  listByDigest(digestId: string): Promise<DigestItemRow[]> {
    return this.db
      .selectFrom("digest_items")
      .select(ITEM_COLUMNS)
      .where("digest_id", "=", digestId)
      .orderBy("kind", "asc") // 'pick' sorts before 'reject'
      .orderBy("rank", "asc")
      .execute();
  }

  findById(id: string): Promise<DigestItemRow | undefined> {
    return this.db
      .selectFrom("digest_items")
      .select(ITEM_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
  }
}
