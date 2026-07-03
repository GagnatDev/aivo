-- Up Migration

-- The single connected YouTube account whose subscriptions feed the digest
-- (docs/data-model.md). Always at most one row — YouTube is a single-account,
-- owner-scoped capability permanently, so the pk is a CHECKed constant. The OAuth
-- refresh token lives in the deployment secrets, NOT here; this row is metadata +
-- sync watermarks only (`subscriptions_synced_at` for the subscription-list refresh,
-- `videos_polled_at` for the new-video poll).
CREATE TABLE youtube_account (
    id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    youtube_channel_id      TEXT,
    title                   TEXT,
    connected_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    subscriptions_synced_at TIMESTAMPTZ,
    videos_polled_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
