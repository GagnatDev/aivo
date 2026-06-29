import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { DegradationState } from "../db/schema.js";

export interface BudgetConfigRow {
  user_id: string;
  monthly_ceiling_cents: number;
  daily_soft_cap_cents: number | null;
  approval_threshold_cents: number | null;
  alert_thresholds: number[];
  degradation_state: DegradationState;
  last_alerted_pct: number;
}

const BUDGET_COLUMNS = [
  "user_id",
  "monthly_ceiling_cents",
  "daily_soft_cap_cents",
  "approval_threshold_cents",
  "alert_thresholds",
  "degradation_state",
  "last_alerted_pct",
] as const;

export interface BudgetPatch {
  monthly_ceiling_cents?: number;
  daily_soft_cap_cents?: number | null;
  approval_threshold_cents?: number | null;
  alert_thresholds?: number[];
}

/** Per-user budget settings, provisioned just-in-time with placeholder defaults. */
export class BudgetConfigRepository {
  constructor(private readonly db: Db) {}

  async getOrCreate(userId: string): Promise<BudgetConfigRow> {
    const row = await this.db
      .insertInto("budget_config")
      .values({ user_id: userId })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ updated_at: sql`now()` }))
      .returning(BUDGET_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  async update(userId: string, patch: BudgetPatch): Promise<BudgetConfigRow> {
    await this.getOrCreate(userId);
    const set: Record<string, unknown> = { updated_at: sql`now()` };
    if (patch.monthly_ceiling_cents !== undefined)
      set.monthly_ceiling_cents = patch.monthly_ceiling_cents;
    if (patch.daily_soft_cap_cents !== undefined)
      set.daily_soft_cap_cents = patch.daily_soft_cap_cents;
    if (patch.approval_threshold_cents !== undefined)
      set.approval_threshold_cents = patch.approval_threshold_cents;
    if (patch.alert_thresholds !== undefined)
      set.alert_thresholds = JSON.stringify(patch.alert_thresholds);
    const row = await this.db
      .updateTable("budget_config")
      .set(set)
      .where("user_id", "=", userId)
      .returning(BUDGET_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Persist the derived degradation state (cheap so it can run every call). */
  async setDegradationState(userId: string, state: DegradationState): Promise<void> {
    await this.db
      .updateTable("budget_config")
      .set({ degradation_state: state, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .execute();
  }

  /** Record the highest alert tier (percent) already fired, to debounce alerts. */
  async recordAlert(userId: string, pct: number): Promise<void> {
    await this.db
      .updateTable("budget_config")
      .set({ last_alerted_pct: pct, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .execute();
  }
}
