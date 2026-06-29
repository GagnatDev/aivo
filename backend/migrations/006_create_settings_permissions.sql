-- Up Migration

-- The owner-managed allow-list of which `settings` keys a non-owner user may edit.
-- A singleton (id = 1, the youtube_account guard idiom) holding a JSONB array of
-- editable column names. v1 has only the owner, so this never actually denies anyone
-- yet -- it is a real forward-looking seam the settings tool consults for non-owners.
-- The owner may edit any setting regardless and manages this list itself.
CREATE TABLE settings_permissions (
    id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    member_editable_keys JSONB NOT NULL DEFAULT '["persona_prompt"]'::jsonb,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings_permissions (id) VALUES (1) ON CONFLICT DO NOTHING;
