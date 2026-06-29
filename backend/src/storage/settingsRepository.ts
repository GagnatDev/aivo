import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface SettingsRow {
  user_id: string;
  digest_hour: number;
  timezone: string;
  digest_cap: number;
  model_tier: string;
  persona_prompt: string | null;
}

const SETTINGS_COLUMNS = [
  "user_id",
  "digest_hour",
  "timezone",
  "digest_cap",
  "model_tier",
  "persona_prompt",
] as const;

/** The columns the settings tool may patch (the reserved digest/proactivity knobs
 * are not editable in this slice). */
export interface SettingsPatch {
  digest_hour?: number;
  timezone?: string;
  digest_cap?: number;
  model_tier?: string;
  persona_prompt?: string | null;
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
    const row = await this.db
      .updateTable("settings")
      .set({ ...patch, updated_at: sql`now()` })
      .where("user_id", "=", userId)
      .returning(SETTINGS_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }
}
