-- Up Migration

-- Cache of the connected account's subscribed channels (docs/data-model.md). v1 is
-- subscriptions-only, so every cached channel is (or was) a subscription of the single
-- connected account — no user_id, no account id. Unsubscribed channels are kept
-- (subscribed = false) because old videos/digest_items still reference them. `muted`
-- comes from feedback ("stop showing me X channel") and excludes the channel from
-- future digests without unsubscribing on YouTube.
CREATE TABLE youtube_channels (
    id              TEXT PRIMARY KEY,               -- YouTube channel id (natural key)
    title           TEXT NOT NULL,
    thumbnail_url   TEXT,
    subscribed      BOOLEAN NOT NULL DEFAULT true,
    subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    unsubscribed_at TIMESTAMPTZ,
    muted           BOOLEAN NOT NULL DEFAULT false,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
