-- Up Migration

-- Saved weather locations (docs/data-model.md). Each row is a place named ("home",
-- "cabin", "Oslo") and resolved to coordinates once (via the geocoder), so a repeat
-- forecast — and the daily morning report — needs no fresh name lookup. A location is
-- either PRIVATE to the user who saved it or SHARED with the whole family (Aivo lives in
-- one family's Discord): `is_shared` marks the family-wide ones ("home", "cabin"), while
-- `user_id` is retained as the creator for provenance. Reads are scoped to a user's own
-- private locations plus every shared one, and a private location shadows a shared one
-- of the same name — so "work" can differ per person. `is_home` marks the single
-- location the owner-configured morning weather report reads (at most one home per user).
--
-- Names are treated case-insensitively ("Oslo" and "oslo" are the same). Uniqueness is
-- split by scope: at most one private location per (user, name), and at most one shared
-- location per name across the whole family — so a private and shared location may share
-- a name (the private one wins on lookup).
CREATE TABLE weather_locations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    display_name TEXT,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    is_home      BOOLEAN NOT NULL DEFAULT false,
    is_shared    BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX weather_locations_private_name_idx
    ON weather_locations (user_id, lower(name)) WHERE NOT is_shared;
CREATE UNIQUE INDEX weather_locations_shared_name_idx
    ON weather_locations (lower(name)) WHERE is_shared;
CREATE UNIQUE INDEX weather_locations_one_home_idx ON weather_locations (user_id) WHERE is_home;
