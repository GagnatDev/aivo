import { en } from "./en.js";
import type { Messages } from "./messages.js";
import { nb } from "./nb.js";

export type { Messages } from "./messages.js";

/** The languages the app supports for user-facing text. */
export const LANGUAGES = ["en", "nb"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * The default language: Norwegian Bokmål. The household speaks Norwegian, so a new user
 * (and the `settings.language` column default) starts in Norwegian and can switch. Kept
 * in sync with the DEFAULT in migration 024.
 */
export const DEFAULT_LANGUAGE: Language = "nb";

const CATALOGS: Record<Language, Messages> = { en, nb };

/** English display names of each language, for system-prompt directives. */
const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  nb: "Norwegian (Bokmål)",
};

/** BCP-47 locales for `Intl` date/number formatting per language. */
const LOCALES: Record<Language, string> = {
  en: "en-GB",
  nb: "nb-NO",
};

/** Type guard: is `value` one of the supported language codes? */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Coerce a stored/settings value to a {@link Language}, falling back to
 * {@link DEFAULT_LANGUAGE}. Use at every read site: `settings.language` is typed `string`
 * (like `model_tier`), and this keeps a stray value from ever selecting a missing catalog.
 */
export function asLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/** The message catalog for a language (falls back to the default on an unknown value). */
export function messages(language: unknown): Messages {
  return CATALOGS[asLanguage(language)];
}

/** English display name, e.g. "Norwegian (Bokmål)". */
export function languageName(language: unknown): string {
  return LANGUAGE_NAMES[asLanguage(language)];
}

/** The BCP-47 locale to hand `Intl` for a language, e.g. "nb-NO". */
export function localeFor(language: unknown): string {
  return LOCALES[asLanguage(language)];
}

/**
 * The line folded into the agent's system prompt so the model replies in the user's
 * preferred language. Phrased to respect an explicit in-conversation override (the owner
 * writes in Norwegian and English freely) rather than forcing one language unconditionally.
 */
export function languageDirective(language: unknown): string {
  return (
    `Reply to the user in ${languageName(language)}. Switch to another language only if the ` +
    `user explicitly asks you to, for as long as they want it.`
  );
}

/**
 * The directive for the digest LLM stages, whose JSON fields (summary/why/reason) are
 * shown to the user verbatim. Written separately from {@link languageDirective} because
 * those stages have no conversation to honour an override from — they always render in
 * the user's configured language.
 */
export function digestLanguageDirective(language: unknown): string {
  return `Write all user-facing text (summaries, reasons, explanations) in ${languageName(language)}.`;
}
