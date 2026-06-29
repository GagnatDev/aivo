import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

/**
 * The owner-managed allow-list of which `settings` keys a non-owner user may edit.
 * Backed by the settings_permissions singleton (id = 1, seeded by migration). The
 * settings tool consults `memberEditableKeys` when a non-owner tries to change a
 * setting; the owner may change anything and manages this list.
 */
export class SettingsPermissionsRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<{ memberEditableKeys: string[] }> {
    const row = await this.db
      .selectFrom("settings_permissions")
      .select("member_editable_keys")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    return { memberEditableKeys: row.member_editable_keys };
  }

  /** Replace the allow-list (owner-only; authorization enforced in the tool). */
  async setKeys(keys: string[]): Promise<string[]> {
    const row = await this.db
      .insertInto("settings_permissions")
      .values({ id: 1, member_editable_keys: JSON.stringify(keys) })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          member_editable_keys: JSON.stringify(keys),
          updated_at: sql`now()`,
        }),
      )
      .returning("member_editable_keys")
      .executeTakeFirstOrThrow();
    return row.member_editable_keys;
  }
}
