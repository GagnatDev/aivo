-- Up Migration

-- Per-user, chat-editable knobs (one row per user, provisioned just-in-time). v1
-- actively uses only `model_tier` (the "use the cheap model this week" override) and
-- `persona_prompt` (an editable system-prompt addendum); the digest/timezone/
-- proactivity columns are reserved with their documented defaults for later slices
-- (see docs/data-model.md). Which of these a non-owner may edit is gated by
-- settings_permissions.
CREATE TABLE settings (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    digest_hour    INT NOT NULL DEFAULT 7,
    timezone       TEXT NOT NULL DEFAULT 'Europe/Oslo',
    digest_cap     INT NOT NULL DEFAULT 8,
    model_tier     TEXT NOT NULL DEFAULT 'auto',   -- auto | cheap | premium
    persona_prompt TEXT,
    proactivity    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
