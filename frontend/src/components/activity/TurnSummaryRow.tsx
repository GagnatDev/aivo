import {
  formatLatency,
  formatTimestamp,
  isDegradedOutcome,
  TURN_OUTCOME_LABELS,
  type TurnSummary,
} from "../../lib/activity.js";

/** "3 tools" / "3 tools, 1 failed" — the failure half is omitted when nothing failed. */
function toolsNote(turn: TurnSummary): string | null {
  if (turn.toolsCalled.length === 0) return null;
  const ran = `${turn.toolsCalled.length} tool${turn.toolsCalled.length === 1 ? "" : "s"}`;
  return turn.toolErrors > 0 ? `${ran}, ${turn.toolErrors} failed` : ran;
}

/** Compact cents, matching the usage page's convention (sub-cent calls are common). */
function formatCents(cents: number): string {
  if (cents >= 100) return `€${(cents / 100).toFixed(2)}`;
  return `${Number(cents.toFixed(2))}¢`;
}

/**
 * The per-turn observability record (A-6), rendered as a separator row between
 * the messages of one turn and the next: iterations, latency, tokens, cost, tool
 * count/errors, and the outcome. It answers "why did that take 40 seconds / cost 12¢"
 * in the dashboard instead of in log aggregation. A turn that ended anywhere but a
 * clean answer (forced, capped, provider error, aborted) is flagged.
 */
export function TurnSummaryRow({ turn }: { turn: TurnSummary }) {
  const tools = toolsNote(turn);
  const degraded = isDegradedOutcome(turn.outcome);
  return (
    <li className={degraded ? "thread-turn thread-turn-degraded" : "thread-turn"}>
      <span className="thread-turn-label">Turn</span>
      <span>{formatTimestamp(turn.createdAt)}</span>
      <span>
        {turn.iterations} round-trip{turn.iterations === 1 ? "" : "s"}
      </span>
      <span>{formatLatency(turn.latencyMs)}</span>
      <span>
        {turn.tokensIn} in / {turn.tokensOut} out tokens
      </span>
      <span>{formatCents(turn.costCents)}</span>
      {tools ? <span>{tools}</span> : null}
      <span className="thread-turn-outcome">{TURN_OUTCOME_LABELS[turn.outcome]}</span>
    </li>
  );
}
