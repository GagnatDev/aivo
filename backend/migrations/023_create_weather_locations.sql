-- Up Migration

-- Per-user saved weather locations (docs/data-model.md). Each row is a place the user
-- named ("home", "cabin", "Oslo") resolved to coordinates once (via the geocoder), so a
-- repeat forecast — and the daily morning report — needs no fresh name lookup. `is_home`
-- marks the single location the owner-configured morning weather report reads; the
-- partial unique index enforces at most one home per user. Names are unique per user,
-- case-insensitively, so "Oslo" and "oslo" address the one saved location.
CREATE TABLE weather_locations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    display_name TEXT,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    is_home      BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX weather_locations_user_name_idx ON weather_locations (user_id, lower(name));
CREATE UNIQUE INDEX weather_locations_one_home_idx ON weather_locations (user_id) WHERE is_home;
