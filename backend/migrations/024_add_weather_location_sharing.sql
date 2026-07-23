-- Up Migration

-- Shared vs. private saved locations. Aivo lives in one family's Discord, and some
-- places are common to everyone ("home", "cabin") while others differ per person
-- ("work"). `is_shared` marks a row as belonging to the whole family rather than to the
-- user who created it: a shared location is visible to, and forecastable by, every user,
-- while `user_id` is retained as the creator for provenance. Anyone in the family may
-- create or remove a shared location (management is not owner-gated); only using the
-- daily morning report stays owner-scoped, unchanged by this migration.
--
-- Name resolution prefers a user's own private location over a shared one of the same
-- name, so "work" can be private-per-user even when a shared "work" also exists. That
-- precedence is enforced in the repository (private-first ordering), and the uniqueness
-- rules split accordingly:
--   * at most one PRIVATE location per (user, name), and
--   * at most one SHARED location per name across the whole family.
ALTER TABLE weather_locations
    ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT false;

-- Replace the blanket per-user name uniqueness with two partial indexes: one guarding
-- private names per user, one guarding shared names family-wide. A private "home" and a
-- shared "home" can therefore coexist (the private one wins on lookup).
DROP INDEX weather_locations_user_name_idx;
CREATE UNIQUE INDEX weather_locations_private_name_idx
    ON weather_locations (user_id, lower(name)) WHERE NOT is_shared;
CREATE UNIQUE INDEX weather_locations_shared_name_idx
    ON weather_locations (lower(name)) WHERE is_shared;
