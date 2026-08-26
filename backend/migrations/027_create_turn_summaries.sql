-- Up Migration

-- Per-turn observability record: the same TurnStats the agent loop already emits as a
-- single "agent turn completed" log line (agent/toolLoop.ts), persisted so the dashboard
-- activity view can show latency / outcome / iteration count / tool-error count per turn
-- instead of requiring log aggregation to answer "why did that take 40 seconds".
--
-- One row per finished turn, written on every exit path (final answer, forced answer,
-- iteration cap, cost ceiling, provider error, abort). `turn_id` is the same id the
-- turn's log lines are tagged with, so a dashboard row and a log line can be correlated.
-- Rows are informational: `cost_cents` is a denormalized copy for display, never a
-- billing source (llm_usage stays the ledger, see migration 008).
--
-- `tools_called` and `finish_reasons` are ordered JSONB string arrays (one entry per
-- tool execution / per model round-trip), matching the JSONB convention messages.tool_calls
-- set in migration 022. The index serves the activity view's per-conversation window read.
CREATE TABLE turn_summaries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id        UUID NOT NULL,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outcome        TEXT NOT NULL,   -- final_answer | forced_answer | iteration_cap | cost_ceiling | provider_error | aborted
    iterations     INT NOT NULL,
    tools_called   JSONB NOT NULL,
    tool_errors    INT NOT NULL,
    tokens_in      INT NOT NULL,
    tokens_out     INT NOT NULL,
    cost_cents     NUMERIC(12,4) NOT NULL,
    latency_ms     INT NOT NULL,
    finish_reasons JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX turn_summaries_conversation_created_idx
    ON turn_summaries (conversation_id, created_at);
