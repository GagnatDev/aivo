import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface SettingsRow {
  user_id: string;
  digest_hour: number;
  timezone: string;
  digest_cap: number;
  digest_interval_days: number;
  model_tier: string;
  persona_prompt: string | null;
  /** The per-lane proactivity state (digest on/off, pause, run-now request) — an
   * opaque JSON object here; the digest lane's shape is owned by digest/proactivity.ts. */
  proactivity: Record<string, unknown>;
}

const SETTINGS_COLUMNS = [
  "user_id",
  "digest_hour",
  "timezone",
  "digest_cap",
  "digest_interval_days",
  "model_tier",
  "persona_prompt",
  "proactivity",
] as const;

/** The columns the settings/digest tools may patch. */
export interface SettingsPatch {
  digest_hour?: number;
  timezone?: string;
  digest_cap?: number;
  digest_interval_days?: number;
  model_tier?: string;
  persona_prompt?: string | null;
  proactivity?: Record<string, unknown>;
}

/** Per-user, chat-editable knobs, provisioned just-in-time on first use. */
export class SettingsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Get the user's settings row, creating it with defaults on first use. Idempotent
   * via the user_id primary key (mirrors ConversationRepository.getOrCreate).
   */
  async getOrCreate(userId: string): Promise<SettingsRow> {
    const row = await this.db
      .insertInto("settings")
      .values({ user_id: userId })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ updated_at: sql`now()` }))
      .returning(SETTINGS_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Apply a partial update, bumping updated_at. Returns the updated row. */
  async update(userId: string, patch: SettingsPatch): Promise<SettingsRow> {
    await this.getOrCreate(userId);
    const { proactivity, ...columns } = patch;
    const row = await this.db
      .updateTable("settings")
      .set({
        ...columns,
        // JSONB crosses the wire as a JSON string (see the ColumnType in db/schema.ts).
        ...(proactivity !== undefined ? { proactivity: JSON.stringify(proactivity) } : {}),
        updated_at: sql`now()`,
      })
      .where("user_id", "=", userId)
      .returning(SETTINGS_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }
}
