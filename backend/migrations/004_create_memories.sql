-- Up Migration

-- The persistent, inspectable memory ("what do you remember about me?" / "forget
-- that"). Human-readable facts/preferences/context the agent writes via the memory
-- tool. `forgotten_at` is a soft-delete so "forget" is reversible and auditable; the
-- partial index keeps lookups of the active set fast. `embedding` (pgvector) is
-- deliberately deferred -- v1 uses category/recency/keyword retrieval.
CREATE TABLE memories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category     TEXT,            -- preference | fact | context
    content      TEXT NOT NULL,
    source       TEXT,            -- chat | inferred (onboarding/feedback later)
    pinned       BOOLEAN NOT NULL DEFAULT false,
    forgotten_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memories_user_active_idx
    ON memories (user_id) WHERE forgotten_at IS NULL;
