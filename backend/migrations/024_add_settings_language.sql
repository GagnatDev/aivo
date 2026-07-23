-- Up Migration

-- The user's preferred language for communication. `en` = English, `nb` = Norwegian
-- Bokmål. Drives two things: the agent's conversational replies (a language directive
-- folded into the system prompt, see agent/context.ts) and every code-generated,
-- verbatim-sent string — Discord button labels, `!` command output, digest/reminder/
-- weather delivery text, approval prompts and error fallbacks (translated via the i18n
-- catalog in src/i18n). Chat-adjustable via the settings tool ("switch to English",
-- "snakk norsk til meg"). Defaults to `nb`: the household speaks Norwegian, so a new
-- user starts in Norwegian and can switch. A real column (not inside `proactivity`)
-- because it is patched by the settings machinery like model_tier/timezone.
ALTER TABLE settings
    ADD COLUMN language TEXT NOT NULL DEFAULT 'nb' CHECK (language IN ('en', 'nb'));
