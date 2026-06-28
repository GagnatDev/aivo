-- Up Migration

-- Household-ready identity. v1 is Discord-only, so a user is keyed by their Discord
-- user id; a row is provisioned just-in-time on a person's first message (see
-- storage/userRepository.ts). `auth_sub` is a reserved, nullable seam so homectl-auth
-- (and a later web dashboard, phase 3) can attach without a migration. Every other
-- table scopes by user_id -> users.id.
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id TEXT NOT NULL UNIQUE,
    auth_sub        TEXT UNIQUE,
    display_name    TEXT,
    is_owner        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
