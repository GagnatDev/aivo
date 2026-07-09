import type { Db } from "../db/kysely.js";
import type { FeedbackSignal } from "../db/schema.enums.js";

export interface FeedbackRow {
  id: string;
  user_id: string;
  digest_item_id: string | null;
  signal: FeedbackSignal;
  freeform_text: string | null;
  applied: boolean;
  created_at: Date;
}

const FEEDBACK_COLUMNS = [
  "id",
  "user_id",
  "digest_item_id",
  "signal",
  "freeform_text",
  "applied",
  "created_at",
] as const;

/** Agreement between the user's keep/drop reactions and the system's picks. */
export interface AgreementStats {
  /** Button reactions counted (freeform is excluded — it carries no verdict). */
  samples: number;
  /** Fraction of reactions that were `keep` (agreement with the pick), 0 when no samples. */
  rate: number;
}

/**
 * Button reactions + freeform replies on digest entries, folded back into the interest
 * profile by the next digest run (which flips `applied`). The keep-rate over recent
 * reactions drives the cold-start rejected-list taper.
 */
export class FeedbackRepository {
  constructor(private readonly db: Db) {}

  async insert(input: {
    userId: string;
    digestItemId?: string | null;
    signal: FeedbackSignal;
    freeformText?: string | null;
  }): Promise<FeedbackRow> {
    return this.db
      .insertInto("feedback")
      .values({
        user_id: input.userId,
        digest_item_id: input.digestItemId ?? null,
        signal: input.signal,
        freeform_text: input.freeformText ?? null,
      })
      .returning(FEEDBACK_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Feedback not yet folded into a profile update, oldest first. */
  listUnapplied(userId: string, limit = 50): Promise<FeedbackRow[]> {
    return this.db
      .selectFrom("feedback")
      .select(FEEDBACK_COLUMNS)
      .where("user_id", "=", userId)
      .where("applied", "=", false)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
  }

  async markApplied(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable("feedback").set({ applied: true }).where("id", "in", ids).execute();
  }

  /** Feedback counts per signal across a digest run's items (dashboard D-4). */
  async countsForDigest(digestId: string): Promise<Partial<Record<FeedbackSignal, number>>> {
    const rows = await this.db
      .selectFrom("feedback")
      .innerJoin("digest_items", "digest_items.id", "feedback.digest_item_id")
      .select((eb) => ["feedback.signal", eb.fn.countAll<string>().as("count")])
      .where("digest_items.digest_id", "=", digestId)
      .groupBy("feedback.signal")
      .execute();
    const counts: Partial<Record<FeedbackSignal, number>> = {};
    for (const row of rows) counts[row.signal] = Number(row.count);
    return counts;
  }

  /**
   * Keep-rate over button reactions since `since`. `keep` counts as agreement; `drop`,
   * `too_long`, and `wrong_topic` count as disagreement; freeform carries no verdict
   * and is excluded.
   */
  async agreementStats(userId: string, since: Date): Promise<AgreementStats> {
    const rows = await this.db
      .selectFrom("feedback")
      .select(["signal"])
      .where("user_id", "=", userId)
      .where("created_at", ">=", since)
      .where("signal", "!=", "freeform")
      .execute();
    const samples = rows.length;
    if (samples === 0) return { samples: 0, rate: 0 };
    const keeps = rows.filter((r) => r.signal === "keep").length;
    return { samples, rate: keeps / samples };
  }
}
