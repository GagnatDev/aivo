import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface UserRow {
  id: string;
  discord_user_id: string;
  auth_sub: string | null;
  display_name: string | null;
  is_owner: boolean;
}

const USER_COLUMNS = [
  "id",
  "discord_user_id",
  "auth_sub",
  "display_name",
  "is_owner",
] as const;

export interface UpsertUserInput {
  discordUserId: string;
  displayName: string | null;
  /** Set once from `discordUserId === env.OWNER_DISCORD_USER_ID` (caller decides). */
  isOwner: boolean;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  findByDiscordId(discordUserId: string): Promise<UserRow | undefined> {
    return this.db
      .selectFrom("users")
      .select(USER_COLUMNS)
      .where("discord_user_id", "=", discordUserId)
      .executeTakeFirst();
  }

  findById(id: string): Promise<UserRow | undefined> {
    return this.db
      .selectFrom("users")
      .select(USER_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * Just-in-time provisioning. Atomic insert-or-touch keyed on `discord_user_id`
   * so two concurrent first messages can't create duplicate rows (mirrors
   * workbench's upsertByAuthSub). Refreshes the cached display name and
   * `updated_at`, then returns the authoritative row. `is_owner` is only set on
   * insert — it is intentionally not downgraded on conflict.
   */
  async upsertByDiscordId(input: UpsertUserInput): Promise<UserRow> {
    const row = await this.db
      .insertInto("users")
      .values({
        discord_user_id: input.discordUserId,
        display_name: input.displayName,
        is_owner: input.isOwner,
      })
      .onConflict((oc) =>
        oc.column("discord_user_id").doUpdateSet({
          display_name: input.displayName,
          updated_at: sql`now()`,
        }),
      )
      .returning(USER_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }
}
