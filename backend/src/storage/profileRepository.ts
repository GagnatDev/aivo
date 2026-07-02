import type { Db } from "../db/kysely.js";
import type { ProfileKind } from "../db/schema.enums.js";

export interface ProfileRow {
  id: string;
  user_id: string;
  kind: ProfileKind;
  body: string;
  version: number;
  is_current: boolean;
}

const PROFILE_COLUMNS = ["id", "user_id", "kind", "body", "version", "is_current"] as const;

/**
 * Versioned natural-language profiles (the YouTube interest profile; later the mail
 * importance profile). A material update inserts a new version and demotes the old
 * current row rather than rewriting in place, so feedback-driven evolution stays
 * traceable. Exactly one current row per (user, kind) — enforced by a partial unique
 * index; the demote+insert runs in one transaction so the invariant can't be observed
 * broken.
 */
export class ProfileRepository {
  constructor(private readonly db: Db) {}

  /** The current profile of a kind for a user, or undefined if none was ever written. */
  getCurrent(userId: string, kind: ProfileKind): Promise<ProfileRow | undefined> {
    return this.db
      .selectFrom("profiles")
      .select(PROFILE_COLUMNS)
      .where("user_id", "=", userId)
      .where("kind", "=", kind)
      .where("is_current", "=", true)
      .executeTakeFirst();
  }

  /** Write a new current version (v1 if none exists, else previous version + 1). */
  async setCurrent(userId: string, kind: ProfileKind, body: string): Promise<ProfileRow> {
    return this.db.transaction().execute(async (trx) => {
      const previous = await trx
        .updateTable("profiles")
        .set({ is_current: false })
        .where("user_id", "=", userId)
        .where("kind", "=", kind)
        .where("is_current", "=", true)
        .returning(["version"])
        .executeTakeFirst();
      return trx
        .insertInto("profiles")
        .values({
          user_id: userId,
          kind,
          body,
          version: (previous?.version ?? 0) + 1,
          is_current: true,
        })
        .returning(PROFILE_COLUMNS)
        .executeTakeFirstOrThrow();
    });
  }
}
