-- Up Migration

-- Prompt-cache pricing. Scaleway now bills input tokens that hit its (automatic,
-- per-project) prompt cache at a discounted rate, so a model carries an optional third
-- token price. NULL means "no cache discount known": cached tokens then cost the full
-- input price, which keeps every pre-028 model's ledger cost exactly as before.
ALTER TABLE model_pricing
    ADD COLUMN cached_input_cost_per_mtok_cents NUMERIC(12,4);

-- How many of a call's tokens_in were served from the provider's prompt cache, as the
-- provider reported it (OpenAI-compatible usage.prompt_tokens_details.cached_tokens).
-- Always a SUBSET of tokens_in, never added to it. 0 when the provider reported none —
-- including servers that don't report the field at all, which therefore bill at the
-- full input price (the conservative direction). Existing rows backfill to 0.
ALTER TABLE llm_usage
    ADD COLUMN tokens_cached INT NOT NULL DEFAULT 0;

-- Scaleway's first cache-priced models at their published prices (pricing page,
-- 2026-10): deepseek-v4-flash-0731 €0.40 in / €0.08 cached / €0.80 out per M;
-- qwen3.8-27b €0.60 in / €0.12 cached / €3.30 out per M (also vision-capable).
-- Priced but NOT assigned to any slot — putting them to use is an explicit owner
-- decision via the models tool (set_tier_role). If the owner already added either via
-- the models tool, only the missing cached price is filled in; their prices stand.
INSERT INTO model_pricing
    (model_id, capabilities, input_cost_per_mtok_cents, cached_input_cost_per_mtok_cents,
     output_cost_per_mtok_cents)
VALUES
    ('deepseek-v4-flash-0731', '["chat"]'::jsonb,           40.0,  8.0,  80.0),
    ('qwen3.8-27b',            '["chat", "vision"]'::jsonb, 60.0, 12.0, 330.0)
ON CONFLICT (model_id) DO UPDATE
    SET cached_input_cost_per_mtok_cents = EXCLUDED.cached_input_cost_per_mtok_cents
    WHERE model_pricing.cached_input_cost_per_mtok_cents IS NULL;
