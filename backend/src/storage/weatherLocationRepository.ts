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
  "created_at",
  "updated_at",
] as const;

export interface WeatherLocationInput {
  name: string;
  latitude: number;
  longitude: number;
  displayName?: string | null;
}

/**
 * A user's saved weather locations (docs/data-model.md). Locations are per-user (like
 * reminders, not owner-gated): every method is scoped to the calling user, so one user
 * can't read or mutate another's. Names are treated case-insensitively — the unique
 * index is on `(user_id, lower(name))`, and lookups lower-case both sides — so "Oslo"
 * and "oslo" are the same saved location. `is_home` marks the one location the morning
 * weather report reads; {@link setHome} moves the flag atomically so there is never
 * more than one home (also guarded by a partial unique index).
 */
export class WeatherLocationRepository {
  constructor(private readonly db: Db) {}

  /** A user's saved locations, home first, then alphabetical by name. */
  list(userId: string): Promise<WeatherLocationRow[]> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where("user_id", "=", userId)
      .orderBy("is_home", "desc")
      .orderBy(sql`lower(name)`, "asc")
      .execute();
  }

  /** Look up one saved location by name (case-insensitive). */
  findByName(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where("user_id", "=", userId)
      .where(sql`lower(name)`, "=", name.trim().toLowerCase())
      .executeTakeFirst();
  }

  /** The user's home location, or undefined if none is set. */
  getHome(userId: string): Promise<WeatherLocationRow | undefined> {
    return this.db
      .selectFrom("weather_locations")
      .select(COLUMNS)
      .where("user_id", "=", userId)
      .where("is_home", "=", true)
      .executeTakeFirst();
  }

  /**
   * Save a location, or refresh the coordinates/display name of one already saved under
   * the same (case-insensitive) name. Never touches the `is_home` flag — re-saving a
   * home location keeps it home. Returns the stored row.
   */
  async upsert(userId: string, input: WeatherLocationInput): Promise<WeatherLocationRow> {
    const existing = await this.findByName(userId, input.name);
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
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Delete a saved location by name (case-insensitive). Returns the removed row, or
   * undefined if the user had no location by that name. */
  remove(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    return this.db
      .deleteFrom("weather_locations")
      .where("user_id", "=", userId)
      .where(sql`lower(name)`, "=", name.trim().toLowerCase())
      .returning(COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Mark a saved location (by name) as the user's home, clearing the flag from any
   * previous home in the same transaction so exactly one home ever exists. Returns the
   * new home row, or undefined if the user has no location by that name.
   */
  async setHome(userId: string, name: string): Promise<WeatherLocationRow | undefined> {
    return this.db.transaction().execute(async (tx) => {
      const target = await tx
        .selectFrom("weather_locations")
        .select(["id"])
        .where("user_id", "=", userId)
        .where(sql`lower(name)`, "=", name.trim().toLowerCase())
        .executeTakeFirst();
      if (!target) return undefined;
      await tx
        .updateTable("weather_locations")
        .set({ is_home: false, updated_at: sql`now()` })
        .where("user_id", "=", userId)
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
}
