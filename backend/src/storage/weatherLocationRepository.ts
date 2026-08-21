import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface WeatherLocationRow {
  id: string;
  user_id: string;
  name: string;
  display_name: string | null;
  latitude: number;
  longitude: number;
  is_home: boolean;
  is_shared: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = [
  "id",
  "user_id",
  "name",
  "display_name",
  "latitude",
  "longitude",
  "is_home",
  "is_shared",
  "created_at",
  "updated_at",
] as const;

export interface WeatherLocationInput {
  name: string;
  latitude: number;
  longitude: number;
  displayName?: string | null;
  /** Save as a family-wide shared location instead of a private one. Defaults to false. */
  shared?: boolean;
}

/**
 * A user's saved weather locations (docs/data-model.md). A location is either PRIVATE to
 * the user who saved it or SHARED with the whole family (Aivo lives in one family's
 * Discord). Every read is scoped to "what this user can see" = their own private
 * locations plus every shared one, and a private location shadows a shared one of the
 * same name — so "cabin"/"home" can be shared while "work" stays private-per-user.
 *
 * Names are treated case-insensitively (the unique indexes are on `lower(name)`, and
 * lookups lower-case both sides). Uniqueness is split by scope: at most one private
 * location per (user, name), and at most one shared location per name family-wide.
 * `is_home` marks the one location the owner's morning report reads; {@link setHome}
 * moves the flag atomically so there is never more than one home in the caller's view.
 */
export class WeatherLocationRepository {
  constructor(private readonly db: Db) {}

  /**
   * A user's saved locations — their own private ones plus every shared one — home
   * first, then private before shared, then alphabetical by name.
   */
  list(userId: string): Promise<WeatherLocationRow[]> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where((eb) => eb.or([eb("user_id", "=", userId), eb("is_shared", "=", true)]))
      .orderBy("is_home", "desc")
      .orderBy("is_shared", "asc")
      .orderBy(sql`lower(name)`, "asc")
      .execute();
  }

  /**
   * Look up one visible location by name (case-insensitive). A user's own private
   * location wins over a shared location of the same name.
   */
  findByName(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where((eb) => eb.or([eb("user_id", "=", userId), eb("is_shared", "=", true)]))
      .where(sql`lower(name)`, "=", name.trim().toLowerCase())
      .orderBy("is_shared", "asc") // private (false) before shared (true)
      .executeTakeFirst();
  }

  /** The home location visible to the user, or undefined if none is set. */
  getHome(userId: string): Promise<WeatherLocationRow | undefined> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where((eb) => eb.or([eb("user_id", "=", userId), eb("is_shared", "=", true)]))
      .where("is_home", "=", true)
      .orderBy("is_shared", "asc")
      .executeTakeFirst();
  }

  /**
   * Save a location, or refresh the coordinates/display name of one already saved under
   * the same (case-insensitive) name and scope. `input.shared` picks the scope: a shared
   * upsert matches/creates the family-wide location of that name, a private one matches/
   * creates this user's own. Never touches the `is_home` flag — re-saving a home
   * location keeps it home. Returns the stored row.
   */
  async upsert(userId: string, input: WeatherLocationInput): Promise<WeatherLocationRow> {
    const shared = input.shared ?? false;
    const existing = await this.findScoped(userId, input.name, shared);
    if (existing) {
      return this.db
        .updateTable("weather_locations")
        .set({
          latitude: input.latitude,
          longitude: input.longitude,
          display_name: input.displayName ?? null,
          updated_at: sql`now()`,
        })
        .where("id", "=", existing.id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
    }
    return this.db
      .insertInto("weather_locations")
      .values({
        user_id: userId,
        name: input.name.trim(),
        latitude: input.latitude,
        longitude: input.longitude,
        display_name: input.displayName ?? null,
        is_shared: shared,
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Delete a visible location by name (case-insensitive), preferring the user's own
   * private location over a shared one of the same name. Shared locations may be removed
   * by any family member. Returns the removed row, or undefined if the user had nothing
   * visible by that name.
   */
  async remove(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    const target = await this.findByName(userId, name);
    if (!target) return undefined;
    return this.db
      .deleteFrom("weather_locations")
      .where("id", "=", target.id)
      .returning(COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Mark a visible location (by name) as the caller's home, clearing the flag from any
   * location currently flagged as home in their view — in the same transaction, so
   * exactly one home ever exists for them. Prefers the user's own private location over
   * a shared one of the same name. Returns the new home row, or undefined if the user
   * has nothing visible by that name.
   */
  async setHome(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    return this.db.transaction().execute(async (tx) => {
      const target = await tx
        .selectFrom("weather_locations")
        .select(["id"])
        .where((eb) => eb.or([eb("user_id", "=", userId), eb("is_shared", "=", true)]))
        .where(sql`lower(name)`, "=", name.trim().toLowerCase())
        .orderBy("is_shared", "asc")
        .executeTakeFirst();
      if (!target) return undefined;
      await tx
        .updateTable("weather_locations")
        .set({ is_home: false, updated_at: sql`now()` })
        .where((eb) => eb.or([eb("user_id", "=", userId), eb("is_shared", "=", true)]))
        .where("is_home", "=", true)
        .execute();
      return tx
        .updateTable("weather_locations")
        .set({ is_home: true, updated_at: sql`now()` })
        .where("id", "=", target.id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
    });
  }

  /** Exact scope-specific lookup used by {@link upsert}: the shared location of this
   * name (family-wide), or this user's own private one. */
  private findScoped(
    userId: string,
    name: string,
    shared: boolean,
  ): Promise<WeatherLocationRow | undefined> {
    let q = this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where("is_shared", "=", shared)
      .where(sql`lower(name)`, "=", name.trim().toLowerCase());
    if (!shared) q = q.where("user_id", "=", userId);
    return q.executeTakeFirst();
  }
}
