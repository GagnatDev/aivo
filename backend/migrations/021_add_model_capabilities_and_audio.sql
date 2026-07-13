-- Up Migration

-- Voice-message support: models grow a capability dimension (chat | audio | vision)
-- alongside the existing cheap/premium cost tier, plus an audio price. Until now every
-- model_pricing row was implicitly a chat model priced per token; a transcription model
-- (Scaleway whisper-large-v3 / voxtral-small-24b-2507) is billed by audio duration and
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

-- Seed rows with Scaleway's published prices (pricing page, 2026-07).
--
-- whisper-large-v3 is billed per audio minute (€0.003/min = 0.3¢/min), so the linear
-- cost formula in agent/budget.ts is exact for it. voxtral-small-24b-2507 is billed per
-- TOKEN (€0.15/M in, €0.35/M out); audio input tokenizes at 1 token per 80 ms, rounded
-- UP to 30-second chunks, plus the transcript as output tokens. Its 0.03¢/min figure is
-- a deliberately slightly-conservative flat equivalent of that shape (60 s ≈ 750 audio
-- tokens ≈ 0.011¢ input + ~0.005¢ output; chunk round-up raises short clips) — see the
-- "Audio model pricing" note in the README.
--
-- voxtral is the CHEAP audio model despite being the stronger one: per minute it is ~10x
-- cheaper than whisper, so cheap-first transcription is also best-quality-first. Scaleway
-- also sells voxtral as a chat model, but it is seeded audio-only on purpose: a role-
-- holding model occupies its role in every capability domain it lists (see the indexes
-- above), so adding "chat" here would make voxtral THE cheap chat model and evict the
-- llama seeded in 007. Whisper's token prices stay 0 — it isn't token-billed at all.
INSERT INTO model_pricing
    (model_id, tier_role, capabilities, input_cost_per_mtok_cents,
     output_cost_per_mtok_cents, audio_cost_per_min_cents)
VALUES
    ('voxtral-small-24b-2507', 'cheap',   '["audio"]'::jsonb, 15.0, 35.0, 0.03),
    ('whisper-large-v3',       'premium', '["audio"]'::jsonb,  0.0,  0.0, 0.3);
