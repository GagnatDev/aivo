-- Up Migration

-- The release instant of a premiere / scheduled live stream. `published_at` comes from
-- the uploads playlist (`playlistItems.contentDetails.videoPublishedAt`), which for a
-- premiere is when the placeholder was announced — always in the PAST, even while the
-- video itself is hours or days away. Presentation asked "is published_at still in the
-- future?" to group unreleased videos at the bottom of the digest, so that grouping
-- never fired and premieres were listed among the watchable picks. The actual release
-- time lives in `videos.liveStreamingDetails` — `scheduledStartTime`, or `actualStartTime`
-- once the stream has begun (a creator may start early) — fetched in the same
-- (already-made) videos.list call as the duration and stored here. Null for an ordinary
-- upload, which releases the moment it is published, and for every video discovered
-- before this column existed (YouTube is not re-polled for videos already ingested).
ALTER TABLE videos
    ADD COLUMN scheduled_start_time TIMESTAMPTZ;
