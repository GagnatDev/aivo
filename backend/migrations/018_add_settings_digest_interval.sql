-- Up Migration

-- How often the digest runs, in days: 1 = daily (the concept default), 2 = every other
-- day, 7 = weekly. Chat-adjustable via the youtube_digest tool ("make the digest
-- weekly"). The digest still fires at `digest_hour` in `timezone` on the days it runs.
-- Kept as a real column (not inside the `proactivity` jsonb) because it is a cadence
-- knob patched by the settings machinery like digest_hour/digest_cap; `proactivity`
-- stays reserved for the per-lane on/off + pause state documented in data-model.md.
ALTER TABLE settings
    ADD COLUMN digest_interval_days INT NOT NULL DEFAULT 1 CHECK (digest_interval_days >= 1);
