-- Up Migration

-- One row per digest run (docs/data-model.md). Owner-scoped permanently: the YouTube
-- lane always references the is_owner user; user_id is kept for schema uniformity, not
-- because YouTube fans out per user. `run_date` (in the user's configured timezone) is
-- the scheduler's idempotence watermark — a restart mid-day doesn't double-send because
-- a row for today already exists. `covers_since` records the "new since last digest"
-- window start. `cost_cents` is fractional (summed from this run's llm_usage rows).
-- No unique index on (user_id, run_date): a manual "run it now" may add a second run
-- on the same date; the scheduler keys off the latest row.
CREATE TABLE digests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_date     DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | skipped_budget
    covers_since TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    cost_cents   NUMERIC(12,4) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX digests_user_created_idx ON digests (user_id, created_at DESC);
