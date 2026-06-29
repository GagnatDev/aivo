-- Up Migration

-- The interactive approval gate's durable state. Before an LLM operation whose
-- estimated cost exceeds the user's approval_threshold_cents, the agent posts a
-- Discord message with Approve/Cancel buttons and records a pending row here. We store
-- the conversation reference and the triggering Discord message id -- NOT a serialized
-- request -- so on Approve the agent rebuilds context from the conversation (the
-- trigger message is already persisted in `messages`). Durable rather than in-memory
-- so a Recreate deploy mid-approval doesn't drop the gate; a button click looks the
-- row up fresh. Stale rows are swept to `expired`.
CREATE TABLE pending_approvals (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    trigger_message_id   TEXT NOT NULL,
    prompt_message_id    TEXT,
    estimated_cost_cents NUMERIC(12,4) NOT NULL,
    task_type            TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | cancelled | expired
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at          TIMESTAMPTZ
);

CREATE INDEX pending_approvals_status_idx ON pending_approvals (status, created_at);
