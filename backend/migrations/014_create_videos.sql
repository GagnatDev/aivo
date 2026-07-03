-- Up Migration

-- Candidate videos discovered from subscriptions, carrying both filter stages
-- (docs/data-model.md). Stage 1 (cheap model) writes `stage1_score`/`stage1_at` from
-- metadata; stage 2 (transcript + summary) writes `transcript_status`,
-- `stage2_decision` (pick | reject — the SYSTEM's verdict; the user's later feedback
-- uses keep/drop, a deliberately distinct vocabulary), the 2–3 bullet TL;DW `summary`,
-- and the one-line `why`. `transcript_status = unavailable` means no caption track
-- existed and the summary was written from metadata only, at lower confidence.
CREATE TABLE videos (
    id                TEXT PRIMARY KEY,             -- YouTube video id (natural key)
    channel_id        TEXT NOT NULL REFERENCES youtube_channels(id),
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    duration_seconds  INT,
    published_at      TIMESTAMPTZ NOT NULL,
    thumbnail_url     TEXT,
    stage1_score      REAL,
    stage1_at         TIMESTAMPTZ,
    transcript_status TEXT NOT NULL DEFAULT 'none', -- none | fetched | unavailable
    stage2_decision   TEXT,                         -- pick | reject
    summary           TEXT,
    why               TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX videos_published_at_idx ON videos (published_at);
