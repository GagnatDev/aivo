-- Up Migration

-- Per-user budget settings (one row per user, provisioned just-in-time). Caps are
-- whole-cent INT; the ledger they're compared against (llm_usage.cost_cents) is
-- fractional, so checks sum the fractional ledger and compare to the integer cap.
-- `degradation_state` is the behavior state machine (normal -> cheap_models ->
-- proactive_paused -> over_ceiling); `alert_thresholds` only notify. The exact
-- threshold->state mapping is app config (see agent/budget.ts), not stored here.
-- `last_alerted_pct` records the highest alert tier already fired so a 50/80/100
-- alert doesn't re-fire on every call; it resets when the month rolls over.
CREATE TABLE budget_config (
    user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    monthly_ceiling_cents    INT NOT NULL DEFAULT 1500,   -- placeholder ~$15
    daily_soft_cap_cents     INT,
    approval_threshold_cents INT,
    alert_thresholds         JSONB NOT NULL DEFAULT '[50,80,100]'::jsonb,
    degradation_state        TEXT NOT NULL DEFAULT 'normal',
    last_alerted_pct         INT NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
