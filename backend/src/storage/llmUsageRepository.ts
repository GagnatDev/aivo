import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface InsertUsageInput {
  userId: string;
  taskType: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** How many of `tokensIn` were prompt-cache hits (a subset, not extra). Defaults to 0. */
  tokensCached?: number;
  /** Fractional cents for this single call. */
  costCents: number;
}

export interface SpendDriver {
  model: string;
  taskType: string;
  costCents: number;
  calls: number;
}

export interface ModelUsageTotal {
  model: string;
  costCents: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Prompt-cache hits among `tokensIn` — tokensCached/tokensIn is the hit ratio. */
  tokensCached: number;
}

export interface UsageLedgerRow {
  createdAt: Date;
  model: string;
  taskType: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costCents: number;
}

export interface DailySeriesOptions {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** Split each day's bucket by model or task type (dashboard chart toggle). */
  groupBy?: "model" | "task_type";
}

export interface DailyUsageBucket {
  /** UTC calendar day, `YYYY-MM-DD` (same `date_trunc` day boundary as todayCents). */
  day: string;
  /** The model / task_type value when grouped, null for plain daily totals. */
  group: string | null;
  costCents: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Prompt-cache hits among `tokensIn`. */
  tokensCached: number;
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
        tokens_cached: input.tokensCached ?? 0,
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

  /**
   * Day-bucketed aggregates for the dashboard's time-series charts (PRD U-1/U-2/U-4),
   * optionally split by model or task type. Days without usage produce no bucket —
   * chart code fills gaps. UTC day boundaries, matching the other rollups here.
   */
  async dailySeries(userId: string, opts: DailySeriesOptions): Promise<DailyUsageBucket[]> {
    const day = sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`;
    // groupBy is a closed union (never raw user input), so interpolating the column
    // name into sql`` is safe; the null branch keeps the row shape uniform.
    const grp =
      opts.groupBy === "model"
        ? sql<string | null>`model`
        : opts.groupBy === "task_type"
          ? sql<string | null>`task_type`
          : sql<string | null>`null`;
    const rows = await this.db
      .selectFrom("llm_usage")
      .select((eb) => [
        day.as("day"),
        grp.as("grp"),
        eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("cost"),
        eb.fn.countAll<string>().as("calls"),
        eb.fn.coalesce(eb.fn.sum("tokens_in"), sql<string>`0`).as("tokensIn"),
        eb.fn.coalesce(eb.fn.sum("tokens_out"), sql<string>`0`).as("tokensOut"),
        eb.fn.coalesce(eb.fn.sum("tokens_cached"), sql<string>`0`).as("tokensCached"),
      ])
      .where("user_id", "=", userId)
      .where("created_at", ">=", opts.from)
      .where("created_at", "<", opts.to)
      .groupBy(day)
      .$if(opts.groupBy !== undefined, (qb) => qb.groupBy(opts.groupBy!))
      .orderBy(day, "asc")
      .$if(opts.groupBy !== undefined, (qb) => qb.orderBy(opts.groupBy!, "asc"))
      .execute();
    return rows.map((r) => ({
      day: r.day,
      group: r.grp,
      costCents: Number(r.cost),
      calls: Number(r.calls),
      tokensIn: Number(r.tokensIn),
      tokensOut: Number(r.tokensOut),
      tokensCached: Number(r.tokensCached),
    }));
  }

  /**
   * Per-model totals since an instant, biggest spender first — the Models page's
   * usage-share view (PRD M-4). Unlike topDrivers this collapses task types, so
   * the share of each model is over the user's whole spend in the window.
   */
  async modelTotals(userId: string, since: Date): Promise<ModelUsageTotal[]> {
    const rows = await this.db
      .selectFrom("llm_usage")
      .select((eb) => [
        "model",
        eb.fn.coalesce(eb.fn.sum("cost_cents"), sql<string>`0`).as("cost"),
        eb.fn.countAll<string>().as("calls"),
        eb.fn.coalesce(eb.fn.sum("tokens_in"), sql<string>`0`).as("tokensIn"),
        eb.fn.coalesce(eb.fn.sum("tokens_out"), sql<string>`0`).as("tokensOut"),
        eb.fn.coalesce(eb.fn.sum("tokens_cached"), sql<string>`0`).as("tokensCached"),
      ])
      .where("user_id", "=", userId)
      .where("created_at", ">=", since)
      .groupBy("model")
      .orderBy("cost", "desc")
      .execute();
    return rows.map((r) => ({
      model: r.model,
      costCents: Number(r.cost),
      calls: Number(r.calls),
      tokensIn: Number(r.tokensIn),
      tokensOut: Number(r.tokensOut),
      tokensCached: Number(r.tokensCached),
    }));
  }

  /**
   * Raw ledger rows in a window, oldest first, capped — the dashboard's CSV export
   * (PRD U-8). The cap bounds response size; the route reports truncation.
   */
  async listRows(
    userId: string,
    opts: { from: Date; to: Date; limit: number },
  ): Promise<UsageLedgerRow[]> {
    const rows = await this.db
      .selectFrom("llm_usage")
      .select([
        "created_at",
        "model",
        "task_type",
        "tokens_in",
        "tokens_out",
        "tokens_cached",
        "cost_cents",
      ])
      .where("user_id", "=", userId)
      .where("created_at", ">=", opts.from)
      .where("created_at", "<", opts.to)
      .orderBy("created_at", "asc")
      .limit(opts.limit)
      .execute();
    return rows.map((r) => ({
      createdAt: r.created_at,
      model: r.model,
      taskType: r.task_type,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      tokensCached: r.tokens_cached,
      costCents: Number(r.cost_cents),
    }));
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
