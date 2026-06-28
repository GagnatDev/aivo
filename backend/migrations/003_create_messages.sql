-- Up Migration

-- Messages within a conversation. `discord_message_id` links assistant output back
-- to the Discord message (needed later to attach reaction buttons / edit).
-- `tokens_in`/`tokens_out` are a denormalized convenience copy only and may be null;
-- the llm_usage ledger (a later slice) is the authoritative cost/token source.
CREATE TABLE messages (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role               TEXT NOT NULL,
    discord_message_id TEXT,
    content            TEXT,
    tokens_in          INT,
    tokens_out         INT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_created_idx
    ON messages (conversation_id, created_at);
