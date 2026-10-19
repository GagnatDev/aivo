import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { StoredFinishReason, TurnOutcome } from "../db/schema.enums.js";

export interface TurnSummaryRow {
  id: string;
  turn_id: string;
  conversation_id: string;
  user_id: string;
  outcome: TurnOutcome;
  iterations: number;
  /** One entry per tool execution, in the order they ran (repeats included). */
  tools_called: string[];
  tool_errors: number;
  tokens_in: number;
  tokens_out: number;
  /** Fractional cents — a display copy of the turn's spend, never a billing source. */
  cost_cents: number;
  latency_ms: number;
  /** One entry per model round-trip, including the forced final answer. */
  finish_reasons: StoredFinishReason[];
  created_at: Date;
}

const TURN_SUMMARY_COLUMNS = [
  "id",
  "turn_id",
  "conversation_id",
  "user_id",
  "outcome",
  "iterations",
  "tools_called",
  "tool_errors",
  "tokens_in",
  "tokens_out",
  "cost_cents",
  "latency_ms",
  "finish_reasons",
  "created_at",
] as const;

export interface InsertTurnSummaryInput {
  /** The id the turn's log lines are tagged with, so a row and a log line correlate. */
  turnId: string;
  conversationId: string;
  userId: string;
  outcome: TurnOutcome;
  iterations: number;
  toolsCalled: string[];
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  latencyMs: number;
  finishReasons: StoredFinishReason[];
}

/** One page of a conversation's turn records, aligned to a page of its messages. */
export interface TurnWindow {
  /** Inclusive lower bound — the timestamp of the message page's oldest row. */
  since: Date;
  /**
   * When set, the lower bound is this message's stored timestamp instead of `since`.
   * TIMESTAMPTZ carries microseconds that a JS `Date` round-trip drops, so a turn
   * written in the same millisecond as the anchor can otherwise fall inside the window.
   */
  sinceMessageId?: string;
  /**
   * Exclusive upper bound, given as the message id the page was anchored on
   * (`?before=`). Omitted for the newest page, which has no upper bound — the last
   * turn's record is written after its final message, so an upper bound there would
   * hide the very turn the user is looking at.
   */
  beforeMessageId?: string;
}

/**
 * The per-turn observability record the agent loop writes on every exit path (see
 * agent/toolLoop.ts). It carries what a single message row cannot: how many
 * round-trips the turn took, how long it ran, whether it ended on a forced answer or
 * a cap, and how many tool calls failed. Rows are informational — `cost_cents` is a
 * denormalized display copy, and `llm_usage` remains the billing ledger.
 */
export class TurnSummaryRepository {
  constructor(private readonly db: Db) {}

  async insert(input: InsertTurnSummaryInput): Promise<TurnSummaryRow> {
    const row = await this.db
      .insertInto("turn_summaries")
      .values({
        turn_id: input.turnId,
        conversation_id: input.conversationId,
        user_id: input.userId,
        outcome: input.outcome,
        iterations: input.iterations,
        // JSONB is written as a JSON string (node-pg returns it parsed on read).
        tools_called: JSON.stringify(input.toolsCalled),
        tool_errors: input.toolErrors,
        tokens_in: input.tokensIn,
        tokens_out: input.tokensOut,
        cost_cents: input.costCents,
        latency_ms: input.latencyMs,
        finish_reasons: JSON.stringify(input.finishReasons),
      })
      .returning(TURN_SUMMARY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toRow(row);
  }

  /**
   * The turn records covering one page of a conversation's messages, oldest first, so
   * the activity view can interleave them with the thread it already fetched. The
   * window is half-open — `[since, before)` — which makes consecutive pages disjoint:
   * a page's `before` anchor is the previous (newer) page's oldest message, so no
   * record is rendered twice when paging back, and none falls between two pages.
   */
  async listForWindow(conversationId: string, window: TurnWindow): Promise<TurnSummaryRow[]> {
    let query = this.db
      .selectFrom("turn_summaries")
      .select(TURN_SUMMARY_COLUMNS)
      .where("conversation_id", "=", conversationId);
    if (window.sinceMessageId) {
      // Same reason as the `before` bound below: compare against the stored
      // TIMESTAMPTZ, not a millisecond-precision Date.
      query = query.where(
        sql<boolean>`turn_summaries.created_at >= (
          select created_at from messages where id = ${window.sinceMessageId} and conversation_id = ${conversationId}
        )`,
      );
    } else {
      query = query.where("created_at", ">=", window.since);
    }
    if (window.beforeMessageId) {
      // The anchor's timestamp is resolved inside this statement rather than via a JS
      // `Date`, for the same reason messageRepository.listPage does it: TIMESTAMPTZ
      // carries microseconds that a millisecond-precision round-trip would drop.
      query = query.where(
        sql<boolean>`turn_summaries.created_at < (
          select created_at from messages where id = ${window.beforeMessageId} and conversation_id = ${conversationId}
        )`,
      );
    }
    const rows = await query.orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return rows.map(toRow);
  }
}

/** node-pg returns `numeric` as a string to preserve precision; parse at the boundary. */
function toRow(row: Omit<TurnSummaryRow, "cost_cents"> & { cost_cents: string }): TurnSummaryRow {
  return { ...row, cost_cents: Number(row.cost_cents) };
}
