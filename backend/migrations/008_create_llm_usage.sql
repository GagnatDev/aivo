-- Up Migration

-- Per-call cost ledger -- the authoritative source of truth for budget caps, alerts,
-- and usage reports. All variable cost is LLM tokens. `cost_cents` is fractional
-- (numeric(12,4)) so a sub-cent call is never rounded to zero. Daily / month-to-date
-- spend is always derived by SUM over this table, never stored as a rollup, so reports
-- and threshold checks can't drift from the ledger. The (user_id, created_at) index
-- backs those rollups. Never sum messages.tokens_* for billing -- those are a
-- denormalized convenience copy only.
CREATE TABLE llm_usage (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type  TEXT NOT NULL,            -- chat (stage1_rank | stage2_summary later)
    model      TEXT NOT NULL,
    tokens_in  INT NOT NULL,
    tokens_out INT NOT NULL,
    cost_cents NUMERIC(12,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX llm_usage_user_created_idx ON llm_usage (user_id, created_at);
