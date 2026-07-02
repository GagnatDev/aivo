-- Up Migration

-- Versioned natural-language profiles (docs/data-model.md): the YouTube interest
-- profile driving the digest's stage-1 ranking, and later the phase-2 mail-importance
-- profile. Human-readable and chat-editable; a material update inserts a new version
-- rather than rewriting in place so feedback evolution stays traceable. Exactly one
-- current row per (user, kind), enforced by the partial unique index.
-- `kind = youtube_interest` is owner-scoped (permanent): YouTube is a single-account
-- capability, so only the is_owner user holds one — enforced in app code, like the
-- other owner invariants.
CREATE TABLE profiles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,                    -- youtube_interest | mail_importance
    body       TEXT NOT NULL,
    version    INT NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_current_per_kind_idx ON profiles (user_id, kind) WHERE is_current;
