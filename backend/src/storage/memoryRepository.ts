import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

/**
 * Escape LIKE/ILIKE wildcards so a user's search term is matched literally. Without
 * this, `%` and `_` in the term act as wildcards (and a trailing `\` would error),
 * making recall unreliable. Postgres uses `\` as the default LIKE escape character.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface MemoryRow {
  id: string;
  user_id: string;
  category: string | null;
  content: string;
  source: string | null;
  pinned: boolean;
  created_at: Date;
  forgotten_at: Date | null;
}

const MEMORY_COLUMNS = [
  "id",
  "user_id",
  "category",
  "content",
  "source",
  "pinned",
  "created_at",
  "forgotten_at",
] as const;

export interface InsertMemoryInput {
  userId: string;
  content: string;
  category?: string | null;
  source?: string | null;
  pinned?: boolean;
}

/**
 * The persistent, inspectable memory ("what do you remember about me?" / "forget
 * that"). Writes go through the agent's memory tool. "forget" is a soft-delete
 * (sets `forgotten_at`) so it is reversible and auditable; reads default to the
 * active set.
 */
export class MemoryRepository {
  constructor(private readonly db: Db) {}

  async insert(input: InsertMemoryInput): Promise<MemoryRow> {
    const row = await this.db
      .insertInto("memories")
      .values({
        user_id: input.userId,
        content: input.content,
        category: input.category ?? null,
        source: input.source ?? null,
        pinned: input.pinned ?? false,
      })
      .returning(MEMORY_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Active (not-forgotten) memories for a user, newest first. */
  listActive(userId: string): Promise<MemoryRow[]> {
    return this.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where("user_id", "=", userId)
      .where("forgotten_at", "is", null)
      .orderBy("created_at", "desc")
      .execute();
  }

  /** Soft-deleted memories, most recently forgotten first — the audit view (ME-8). */
  listForgotten(userId: string): Promise<MemoryRow[]> {
    return this.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where("user_id", "=", userId)
      .where("forgotten_at", "is not", null)
      .orderBy("forgotten_at", "desc")
      .execute();
  }

  /**
   * Keyword search over active memories (case-insensitive substring on content),
   * newest first. The simple category/recency/keyword retrieval of v1 — pgvector is
   * deferred.
   */
  search(userId: string, term: string, limit = 20): Promise<MemoryRow[]> {
    return this.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where("user_id", "=", userId)
      .where("forgotten_at", "is", null)
      .where("content", "ilike", `%${escapeLike(term)}%`)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * Soft-delete a memory ("forget that"). Scoped by user so one user can't forget
   * another's memory. Returns the updated row, or undefined if it didn't exist / was
   * already forgotten / belonged to someone else.
   */
  async forget(id: string, userId: string): Promise<MemoryRow | undefined> {
    return this.db
      .updateTable("memories")
      .set({ forgotten_at: sql`now()`, updated_at: sql`now()` })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .where("forgotten_at", "is", null)
      .returning(MEMORY_COLUMNS)
      .executeTakeFirst();
  }
}
