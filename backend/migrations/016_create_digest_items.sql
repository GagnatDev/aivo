-- Up Migration

-- A digest run's entries (docs/data-model.md), distinguishing ranked picks from the
-- rejected list (with one-line reasons) that drives cold-start boundary calibration.
-- `kind` is the system's verdict vocabulary (pick | reject). `rank` is set on picks
-- (1-based; picks beyond the delivered cap keep their rank and are surfaced on request
-- — "N more matched, lower confidence"). `reason` is set on rejects. The video FK has
-- no cascade: videos referenced by any digest item are retained when the cache is
-- pruned.
CREATE TABLE digest_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    digest_id  UUID NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
    video_id   TEXT NOT NULL REFERENCES videos(id),
    kind       TEXT NOT NULL,                      -- pick | reject
    rank       INT,
    reason     TEXT,
    confidence REAL
);

CREATE INDEX digest_items_digest_idx ON digest_items (digest_id);
