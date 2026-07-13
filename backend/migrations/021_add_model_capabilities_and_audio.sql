-- Up Migration

-- Voice-message support: models grow a capability dimension (chat | audio | vision)
-- alongside the existing cheap/premium cost tier, plus an audio price. Until now every
-- model_pricing row was implicitly a chat model priced per token; a transcription model
-- (Scaleway whisper-large-v3 / voxtral-small-24b-2507) is billed per audio-minute and
-- must never be picked for a chat turn. `capabilities` (jsonb array) makes that explicit
-- and future-proofs vision. `audio_cost_per_min_cents` is set only for audio models; the
-- STT cost of a voice note = (duration_secs / 60) * this rate (see agent/budget.ts).
ALTER TABLE model_pricing
    ADD COLUMN capabilities              JSONB NOT NULL DEFAULT '["chat"]'::jsonb,
    ADD COLUMN audio_cost_per_min_cents  NUMERIC(12,4);   -- null for non-audio models

-- The cheap/premium role is now scoped per capability domain, not global: there is
-- exactly one cheap + one premium CHAT model AND (independently) one cheap + one premium
-- AUDIO model, so a premium audio model can coexist with a premium chat model. The old
-- global one-per-role index forbade that. `jsonb @> jsonb` is immutable, so it is legal
-- in a partial-index predicate.
DROP INDEX model_pricing_one_per_role_idx;

CREATE UNIQUE INDEX model_pricing_one_chat_per_role_idx
    ON model_pricing (tier_role)
    WHERE tier_role IS NOT NULL AND capabilities @> '["chat"]'::jsonb;

CREATE UNIQUE INDEX model_pricing_one_audio_per_role_idx
    ON model_pricing (tier_role)
    WHERE tier_role IS NOT NULL AND capabilities @> '["audio"]'::jsonb;

-- PLACEHOLDER seed rows, same convention as the llama rows in 007: the model ids and the
-- audio price are NOT confirmed Scaleway values — the owner corrects them via the models
-- tool ("check Scaleway's audio pricing and update these"). They exist only so an audio
-- model resolves on first boot. Per-token prices stay 0: audio models never take the
-- per-token chat cost path, and whisper isn't token-billed at all.
INSERT INTO model_pricing
    (model_id, tier_role, capabilities, input_cost_per_mtok_cents,
     output_cost_per_mtok_cents, audio_cost_per_min_cents)
VALUES
    ('voxtral-small-24b-2507', 'premium', '["audio"]'::jsonb, 0.0, 0.0, 10.0),
    ('whisper-large-v3',       'cheap',   '["audio"]'::jsonb, 0.0, 0.0,  3.0);
