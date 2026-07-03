import type { Db } from "../db/kysely.js";
import type { ReminderStatus } from "../db/schema.enums.js";

export interface ReminderRow {
  id: string;
  user_id: string;
  text: string;
  due_at: Date;
  status: ReminderStatus;
  delivered_at: Date | null;
  created_at: Date;
}

const REMINDER_COLUMNS = [
  "id",
  "user_id",
  "text",
  "due_at",
  "status",
  "delivered_at",
  "created_at",
] as const;

/**
 * User-set reminders delivered proactively by the scheduler (docs/data-model.md).
 * Cancel is a soft delete via `status` so the agent's actions stay auditable and
 * reversible; a snooze re-arms the same row (back to pending with a new due_at)
 * instead of inserting a duplicate.
 */
export class ReminderRepository {
  constructor(private readonly db: Db) {}

  insert(input: { userId: string; text: string; dueAt: Date }): Promise<ReminderRow> {
    return this.db
      .insertInto("reminders")
      .values({ user_id: input.userId, text: input.text, due_at: input.dueAt })
      .returning(REMINDER_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  findById(id: string): Promise<ReminderRow | undefined> {
    return this.db
      .selectFrom("reminders")
      .select(REMINDER_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** A user's upcoming (pending) reminders, soonest first. */
  listPending(userId: string): Promise<ReminderRow[]> {
    return this.db
      .selectFrom("reminders")
      .select(REMINDER_COLUMNS)
      .where("user_id", "=", userId)
      .where("status", "=", "pending")
      .orderBy("due_at", "asc")
      .execute();
  }

  /** All pending reminders due at or before `now` (any user), soonest first. */
  listDue(now: Date): Promise<ReminderRow[]> {
    return this.db
      .selectFrom("reminders")
      .select(REMINDER_COLUMNS)
      .where("status", "=", "pending")
      .where("due_at", "<=", now)
      .orderBy("due_at", "asc")
      .execute();
  }

  async markDelivered(id: string, at: Date): Promise<void> {
    await this.db
      .updateTable("reminders")
      .set({ status: "delivered", delivered_at: at })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Cancel a pending reminder. Scoped by user so one user can't cancel another's.
   * Returns the updated row, or undefined if it didn't exist / wasn't pending /
   * belonged to someone else.
   */
  cancel(id: string, userId: string): Promise<ReminderRow | undefined> {
    return this.db
      .updateTable("reminders")
      .set({ status: "cancelled" })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .where("status", "=", "pending")
      .returning(REMINDER_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Move a reminder to a new due time and re-arm it — the "reschedule" tool action
   * and the snooze buttons on a delivered reminder. Cancelled reminders stay
   * cancelled (set a new one instead). Scoped by user like {@link cancel}.
   */
  reschedule(id: string, userId: string, dueAt: Date): Promise<ReminderRow | undefined> {
    return this.db
      .updateTable("reminders")
      .set({ due_at: dueAt, status: "pending", delivered_at: null })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .where("status", "!=", "cancelled")
      .returning(REMINDER_COLUMNS)
      .executeTakeFirst();
  }
}
