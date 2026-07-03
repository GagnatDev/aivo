-- Up Migration

-- User-set reminders delivered proactively via the scheduler (docs/data-model.md).
-- `cancel` is a soft delete via status (auditable, reversible — docs/data-model.md
-- cross-cutting notes); a snooze re-arms a delivered row (status back to pending with
-- a new due_at) rather than inserting a duplicate, so one reminder keeps one history.
-- The partial index serves the scheduler's minutely "what is due?" scan.
CREATE TABLE reminders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    due_at       TIMESTAMPTZ NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | cancelled
    delivered_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reminders_due_idx ON reminders (due_at) WHERE status = 'pending';
CREATE INDEX reminders_user_created_idx ON reminders (user_id, created_at DESC);
