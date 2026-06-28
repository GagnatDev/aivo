-- Up Migration

-- Chat context per channel. The per-capability channels (chat | youtube | mail)
-- come from docs/concept.md; v1 only uses `chat`. The UNIQUE (user_id, channel)
-- keeps v1 to one running conversation per channel per user, so getOrCreate is a
-- clean upsert (see storage/conversationRepository.ts).
CREATE TABLE conversations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel            TEXT NOT NULL,
    discord_channel_id TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, channel)
);
