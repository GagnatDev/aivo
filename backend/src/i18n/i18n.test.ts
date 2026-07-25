import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import {
  asLanguage,
  DEFAULT_LANGUAGE,
  isLanguage,
  languageDirective,
  languageName,
  LANGUAGES,
  localeFor,
  messages,
} from "./index.js";
import { nb } from "./nb.js";

describe("i18n helpers", () => {
  it("defaults to Norwegian Bokmål", () => {
    expect(DEFAULT_LANGUAGE).toBe("nb");
  });

  it("recognizes supported languages and coerces unknowns to the default", () => {
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("nb")).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(asLanguage("en")).toBe("en");
    expect(asLanguage("gibberish")).toBe(DEFAULT_LANGUAGE);
    expect(asLanguage(null)).toBe(DEFAULT_LANGUAGE);
  });

  it("maps each language to a display name and an Intl locale", () => {
    expect(languageName("nb")).toBe("Norwegian (Bokmål)");
    expect(languageName("en")).toBe("English");
    expect(localeFor("nb")).toBe("nb-NO");
    expect(localeFor("en")).toBe("en-GB");
  });

  it("builds a language directive naming the target language", () => {
    expect(languageDirective("nb")).toContain("Norwegian (Bokmål)");
    expect(languageDirective("en")).toContain("English");
  });

  it("returns the catalog for a language, falling back to the default", () => {
    expect(messages("en")).toBe(en);
    expect(messages("nb")).toBe(nb);
    expect(messages("xx")).toBe(nb); // default
  });
});

describe("catalog parity", () => {
  // The Messages interface enforces structural parity at compile time; this guards the
  // one place TS can't — the `symbols` string map — so a MET code translated in one
  // language is translated in both.
  it("translates the same weather symbol codes in every language", () => {
    for (const lang of LANGUAGES) {
      expect(Object.keys(messages(lang).weather.symbols).sort()).toEqual(
        Object.keys(en.weather.symbols).sort(),
      );
    }
  });

  it("renders non-empty text for representative entries in every language", () => {
    for (const lang of LANGUAGES) {
      const m = messages(lang);
      expect(m.feedback.keep.length).toBeGreaterThan(0);
      expect(m.approval.prompt(5, 3).length).toBeGreaterThan(0);
      expect(m.digest.header("2026-07-01", 2).length).toBeGreaterThan(0);
      expect(m.weather.morningHeader("Oslo", "torsdag").length).toBeGreaterThan(0);
    }
  });
});
