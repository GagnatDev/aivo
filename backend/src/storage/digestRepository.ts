import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { DigestFailureKind, DigestStatus } from "../db/schema.enums.js";

export interface DigestRow {
  id: string;
  user_id: string;
  /** The run's local calendar date as `YYYY-MM-DD` (read via ::text so no tz surprises). */
  run_date: string;
  status: DigestStatus;
  covers_since: Date;
  delivered_at: Date | null;
  cost_cents: string;
  /** Why the run failed — both null unless `status` is `failed`. */
  failure_kind: DigestFailureKind | null;
  failure_message: string | null;
  created_at: Date;
}

// run_date is a DATE column; selecting it raw would surface a Date at local midnight.
// Reading it as text keeps the scheduler's watermark comparisons purely calendrical.
const DIGEST_SELECT = [
  "id",
  "user_id",
  sql<string>`run_date::text`.as("run_date"),
  "status",
  "covers_since",
  "delivered_at",
  "cost_cents",
  "failure_kind",
  "failure_message",
  "created_at",
] as const;

/**
 * Digest runs (docs/data-model.md). The latest row per user is the scheduler's
 * idempotence watermark: a run is created (status pending) BEFORE the pipeline does any
 * paid work, so a crash mid-run leaves a pending row that stops the minutely tick from
 * re-spending that day — the owner can still force a retry from chat ("run the digest
 * now").
 */
export class DigestRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    userId: string;
    runDate: string;
    coversSince: Date;
    status?: DigestStatus;
  }): Promise<DigestRow> {
    return this.db
      .insertInto("digests")
      .values({
        user_id: input.userId,
        run_date: input.runDate,
        covers_since: input.coversSince,
        status: input.status ?? "pending",
      })
      .returning(DIGEST_SELECT)
      .executeTakeFirstOrThrow();
  }

  /** The most recently created digest for a user, regardless of status. */
  latestForUser(userId: string): Promise<DigestRow | undefined> {
    return this.db
      .selectFrom("digests")
      .select(DIGEST_SELECT)
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /** A user's digest runs, newest first (dashboard history, PRD D-1). */
  listForUser(userId: string, limit = 50): Promise<DigestRow[]> {
    return this.db
      .selectFrom("digests")
      .select(DIGEST_SELECT)
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  /** One run, scoped by user so the API can't serve another user's digest. */
  findByIdForUser(id: string, userId: string): Promise<DigestRow | undefined> {
    return this.db
      .selectFrom("digests")
      .select(DIGEST_SELECT)
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  async markDelivered(id: string, at: Date): Promise<void> {
    await this.db
      .updateTable("digests")
      .set({ status: "delivered", delivered_at: at })
      .where("id", "=", id)
      .execute();
  }

  async setStatus(id: string, status: DigestStatus): Promise<void> {
    await this.db.updateTable("digests").set({ status }).where("id", "=", id).execute();
  }

  /**
   * Mark a run failed and record why (digest/failure.ts). Without this a run whose
   * pipeline threw stayed `pending` — indistinguishable on the dashboard from one still
   * in flight — and the reason lived only in the pod log.
   */
  async markFailed(
    id: string,
    failure: { kind: DigestFailureKind; message: string },
  ): Promise<void> {
    await this.db
      .updateTable("digests")
      .set({ status: "failed", failure_kind: failure.kind, failure_message: failure.message })
      .where("id", "=", id)
      .execute();
  }

  /** Record the run's total LLM cost (fractional cents, summed by the pipeline). */
  async setCostCents(id: string, costCents: number): Promise<void> {
    await this.db
      .updateTable("digests")
      .set({ cost_cents: String(costCents) })
      .where("id", "=", id)
      .execute();
  }
}
