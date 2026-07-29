-- Up Migration

-- Why a digest run failed. Before this, a run whose pipeline threw (e.g. the YouTube
-- OAuth refresh token expired) left its row at `status = 'pending'` forever: the
-- dashboard reported the run as still in flight and the only trace of the cause was the
-- pod log. `status` gains a fourth value, `failed`, and these two columns carry the
-- reason: `failure_kind` is the coarse, switchable classification the Discord and
-- dashboard layers phrase a message from (youtube_auth | youtube_api | llm | unknown),
-- `failure_message` the human-readable detail behind it. Both stay null on a run that
-- didn't fail. No CHECK constraint on either, matching `status`/`kind` elsewhere in the
-- schema — the string-literal unions live in db/schema.enums.ts.
ALTER TABLE digests
    ADD COLUMN failure_kind    TEXT,
    ADD COLUMN failure_message TEXT;
