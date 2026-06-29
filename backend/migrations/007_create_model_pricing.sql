-- Up Migration

-- DB-backed model + pricing config. Unlike the docs' original env-based plan, model
-- ids and prices live here so the owner can ask the agent to refresh prices against
-- Scaleway's docs and swap which model is cheap/premium without a redeploy. Reads are
-- open to the agent; writes are owner-only and only on explicit request (enforced in
-- the models tool, not here). `tier_role` marks the active cheap/premium model; the
-- partial unique index allows exactly one active model per role.
--
-- Price unit: cents per 1,000,000 tokens (numeric(12,4)), matching how providers
-- quote prices and the project's fractional-cents money convention. cost_cents at log
-- time = (tokens_in*input + tokens_out*output) / 1_000_000.
CREATE TABLE model_pricing (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id                   TEXT NOT NULL UNIQUE,
    tier_role                  TEXT,            -- cheap | premium | NULL (inactive)
    input_cost_per_mtok_cents  NUMERIC(12,4) NOT NULL,
    output_cost_per_mtok_cents NUMERIC(12,4) NOT NULL,
    currency                   TEXT NOT NULL DEFAULT 'EUR',
    active                     BOOLEAN NOT NULL DEFAULT true,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX model_pricing_one_per_role_idx
    ON model_pricing (tier_role) WHERE tier_role IS NOT NULL;

-- PLACEHOLDER seed rows. The model ids and prices below are NOT real Scaleway values;
-- the owner corrects them via the models tool ("check Scaleway's current pricing and
-- update these"). They exist only so the agent has a cheap/premium model to resolve
-- on first boot.
INSERT INTO model_pricing
    (model_id, tier_role, input_cost_per_mtok_cents, output_cost_per_mtok_cents)
VALUES
    ('llama-3.1-8b-instruct',  'cheap',   20.0, 20.0),
    ('llama-3.3-70b-instruct', 'premium', 90.0, 90.0);
