import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { ApprovalStatus } from "../db/schema.js";

export interface PendingApprovalRow {
  id: string;
  user_id: string;
  conversation_id: string;
  trigger_message_id: string;
  prompt_message_id: string | null;
  estimated_cost_cents: string;
  task_type: string;
  status: ApprovalStatus;
}

const APPROVAL_COLUMNS = [
  "id",
  "user_id",
  "conversation_id",
  "trigger_message_id",
  "prompt_message_id",
  "estimated_cost_cents",
  "task_type",
  "status",
] as const;

export interface CreateApprovalInput {
  userId: string;
  conversationId: string;
  triggerMessageId: string;
  estimatedCostCents: number;
  taskType: string;
}

/**
 * Durable state for the interactive approval gate. We store a conversation reference,
 * not a serialized request, so an approved operation rebuilds context on resume —
 * which is what lets the gate survive a Recreate deploy.
 */
export class PendingApprovalRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateApprovalInput): Promise<PendingApprovalRow> {
    const row = await this.db
      .insertInto("pending_approvals")
      .values({
        user_id: input.userId,
        conversation_id: input.conversationId,
        trigger_message_id: input.triggerMessageId,
        estimated_cost_cents: input.estimatedCostCents,
        task_type: input.taskType,
      })
      .returning(APPROVAL_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  findById(id: string): Promise<PendingApprovalRow | undefined> {
    return this.db
      .selectFrom("pending_approvals")
      .select(APPROVAL_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** Record the Discord message id of the Approve/Cancel prompt. */
  async setPromptMessageId(id: string, promptMessageId: string): Promise<void> {
    await this.db
      .updateTable("pending_approvals")
      .set({ prompt_message_id: promptMessageId })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Transition a still-pending approval to a terminal status. Returns the updated row,
   * or undefined if it was not pending (already resolved / unknown) — this guards
   * against a double-click or a click on a swept-expired prompt.
   */
  async resolveIfPending(
    id: string,
    status: Exclude<ApprovalStatus, "pending">,
  ): Promise<PendingApprovalRow | undefined> {
    return this.db
      .updateTable("pending_approvals")
      .set({ status, resolved_at: sql`now()` })
      .where("id", "=", id)
      .where("status", "=", "pending")
      .returning(APPROVAL_COLUMNS)
      .executeTakeFirst();
  }

  /** Sweep pending approvals older than a cutoff to `expired`. Returns the count. */
  async expireOlderThan(cutoff: Date): Promise<number> {
    const rows = await this.db
      .updateTable("pending_approvals")
      .set({ status: "expired", resolved_at: sql`now()` })
      .where("status", "=", "pending")
      .where("created_at", "<", cutoff)
      .returning("id")
      .execute();
    return rows.length;
  }
}
