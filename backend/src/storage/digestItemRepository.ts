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

export interface DigestItemCounts {
  picks: number;
  rejects: number;
}

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

  /** Pick/reject counts per digest, for run lists that show totals without items. */
  async countsByDigests(digestIds: string[]): Promise<Map<string, DigestItemCounts>> {
    if (digestIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("digest_items")
      .select((eb) => ["digest_id", "kind", eb.fn.countAll<string>().as("count")])
      .where("digest_id", "in", digestIds)
      .groupBy(["digest_id", "kind"])
      .execute();
    const counts = new Map<string, DigestItemCounts>();
    for (const row of rows) {
      const entry = counts.get(row.digest_id) ?? { picks: 0, rejects: 0 };
      if (row.kind === "pick") entry.picks = Number(row.count);
      else entry.rejects = Number(row.count);
      counts.set(row.digest_id, entry);
    }
    return counts;
  }

  findById(id: string): Promise<DigestItemRow | undefined> {
    return this.db
      .selectFrom("digest_items")
      .select(ITEM_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
  }
}
