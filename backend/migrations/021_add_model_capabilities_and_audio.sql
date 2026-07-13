-- Up Migration

-- Voice-message support. Two orthogonal facts used to share one mechanism (a tier_role
-- column on model_pricing): what a model CAN do and what it IS USED for. This migration
-- separates them. model_pricing keeps facts about the model — capabilities metadata
-- (chat | audio | vision) and prices, including a new per-minute audio price — while
-- "which model serves which purpose" moves into model_tier_assignments, keyed on the
-- slot it fills.
ALTER TABLE model_pricing
    ADD COLUMN capabilities              JSONB NOT NULL DEFAULT '["chat"]'::jsonb,
    ADD COLUMN audio_cost_per_min_cents  NUMERIC(12,4);   -- null for non-audio models

-- The assignment table. A slot is (capability, tier_role) — e.g. "the cheap audio
-- model" — and the primary key IS the one-model-per-slot rule, replacing the old
-- one-per-role partial unique index. One model may fill any number of slots (voxtral
-- holds both audio slots below; it could additionally hold a chat slot), so declaring
-- a capability on a model is side-effect free: usage changes only when a slot is
-- explicitly assigned. Assigning is a single upsert on the slot — no cross-domain
-- clearing, no transaction gymnastics.
CREATE TABLE model_tier_assignments (
    capability  TEXT NOT NULL CHECK (capability IN ('chat', 'audio', 'vision')),
    tier_role   TEXT NOT NULL CHECK (tier_role IN ('cheap', 'premium')),
    model_id    TEXT NOT NULL REFERENCES model_pricing(model_id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (capability, tier_role)
);

-- Carry the existing role holders over (every pre-021 model is a chat model), then
-- retire the old mechanism.
INSERT INTO model_tier_assignments (capability, tier_role, model_id)
SELECT 'chat', tier_role, model_id FROM model_pricing WHERE tier_role IS NOT NULL;

DROP INDEX model_pricing_one_per_role_idx;
ALTER TABLE model_pricing DROP COLUMN tier_role;

-- Scaleway's audio models at their published prices (pricing page, 2026-07).
--
-- whisper-large-v3 is billed per audio minute (€0.003/min = 0.3¢/min), so the linear
-- cost formula in agent/budget.ts is exact for it. voxtral-small-24b-2507 is billed per
-- TOKEN (€0.15/M in, €0.35/M out); audio input tokenizes at 1 token per 80 ms, rounded
-- UP to 30-second chunks, plus the transcript as output tokens. Its 0.03¢/min figure is
-- a deliberately slightly-conservative flat equivalent of that shape (60 s ≈ 750 audio
-- tokens ≈ 0.011¢ input + ~0.005¢ output; chunk round-up raises short clips) — see the
-- "Audio model pricing" note in the README. voxtral is declared chat-capable because it
-- genuinely is one (Scaleway sells it for chat at the token prices stored here); that
-- declaration assigns nothing — putting it in a chat slot is an explicit owner decision
-- via the models tool.
INSERT INTO model_pricing
    (model_id, capabilities, input_cost_per_mtok_cents, output_cost_per_mtok_cents,
     audio_cost_per_min_cents)
VALUES
    ('voxtral-small-24b-2507', '["chat", "audio"]'::jsonb, 15.0, 35.0, 0.03),
    ('whisper-large-v3',       '["audio"]'::jsonb,          0.0,  0.0, 0.3);

-- voxtral fills BOTH audio slots: it is ~10x cheaper per minute than whisper AND the
-- stronger transcriber, so budget degradation has nothing cheaper to reach for. whisper
-- stays priced but unassigned — one set_tier_role away if ever wanted.
INSERT INTO model_tier_assignments (capability, tier_role, model_id)
VALUES
    ('audio', 'cheap',   'voxtral-small-24b-2507'),
    ('audio', 'premium', 'voxtral-small-24b-2507');
