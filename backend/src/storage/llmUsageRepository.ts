import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface InsertUsageInput {
  userId: string;
  taskType: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Fractional cents for this single call. */
  costCents: number;
}

export interface SpendDriver {
  model: string;
  taskType: string;
  costCents: number;
  calls: number;
}

/**
 * The authoritative per-call cost ledger. Spend is always derived here by SUM — never
 * stored as a rollup — so caps, alerts, and reports can't drift. `numeric` sums come
 * back as strings; we parse them to numbers at the boundary.
 */
export class LlmUsageRepository {
  constructor(private readonly db: Db) {}

  async insert(input: InsertUsageInput): Promise<void> {
    await this.db
      .insertInto("llm_usage")
      .values({
        user_id: input.userId,
        task_type: input.taskType,
        model: input.model,
        tokens_in: input.tokensIn,
        tokens_out: input.tokensOut,
        cost_cents: input.costCents,
      })
      .execute();
  }

  /** Total fractional cents for a user since an instant (inclusive). */
  async spendSinceCents(userId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom("llm_usage")
      .select((eb) => eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("total"))
      .where("user_id", "=", userId)
      .where("created_at", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Total fractional cents this calendar month (UTC month boundary, v1 simplicity). */
  async monthToDateCents(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom("llm_usage")
      .select((eb) => eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("total"))
      .where("user_id", "=", userId)
      .where("created_at", ">=", sql<Date>`date_trunc('month', now())`)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Total fractional cents today (UTC day boundary, v1 simplicity). */
  async todayCents(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom("llm_usage")
      .select((eb) => eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("total"))
      .where("user_id", "=", userId)
      .where("created_at", ">=", sql<Date>`date_trunc('day', now())`)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Biggest spend drivers since an instant, grouped by (model, task_type). */
  async topDrivers(userId: string, since: Date, limit = 5): Promise<SpendDriver[]> {
    const rows = await this.db
      .selectFrom("llm_usage")
      .select((eb) => [
        "model",
        "task_type as taskType",
        eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("cost"),
        eb.fn.countAll<string>().as("calls"),
      ])
      .where("user_id", "=", userId)
      .where("created_at", ">=", since)
      .groupBy(["model", "task_type"])
      .orderBy("cost", "desc")
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      model: r.model,
      taskType: r.taskType,
      costCents: Number(r.cost),
      calls: Number(r.calls),
    }));
  }
}
