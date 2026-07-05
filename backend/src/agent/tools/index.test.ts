import { describe, expect, it } from "vitest";
import { buildToolRegistry, resolveTier, selectToolSchemas } from "./index.js";

describe("resolveTier", () => {
  it("maps auto and unknown to premium, honors explicit tiers", () => {
    expect(resolveTier("auto")).toBe("premium");
    expect(resolveTier("cheap")).toBe("cheap");
    expect(resolveTier("premium")).toBe("premium");
  });
});

describe("selectToolSchemas", () => {
  const reg = buildToolRegistry();
  const names = (text: string) =>
    selectToolSchemas(reg, text)
      .map((s) => s.name)
      .sort();

  it("always advertises memory and gates the rest out of small talk", () => {
    expect(names("how's it going today?")).toEqual(["memory"]);
    expect(names("")).toEqual(["memory"]);
  });

  it("includes budget when the message is about spend or money", () => {
    expect(names("how much have I spent this month?")).toContain("budget");
    expect(names("set my monthly cap to $20")).toContain("budget");
    expect(names("what's my budget?")).toContain("budget");
  });

  it("includes models when the message is about models or pricing", () => {
    expect(names("add a new model and set its price")).toContain("models");
    expect(names("which llama model is the premium tier?")).toContain("models");
  });

  it("includes settings when the message is about settings", () => {
    expect(names("change my timezone")).toContain("settings");
    expect(names("update my digest hour")).toContain("settings");
  });

  it("includes reminder when the message is about reminders", () => {
    expect(names("remind me to call X at 5")).toContain("reminder");
    expect(names("what reminders do I have?")).toContain("reminder");
    expect(names("snooze that")).toContain("reminder");
  });

  it("matches case-insensitively", () => {
    expect(names("What's My BUDGET?")).toContain("budget");
  });

  // The owner writes in Norwegian as often as English; an English-only gate silently
  // strips the capability for those turns (the model can't call a schema it never saw).
  describe("Norwegian phrasing (owner's language)", () => {
    it("includes reminder for Norwegian reminder/snooze phrasings", () => {
      // The reported bug: this used to advertise only memory, so no reminder was ever set.
      expect(names("minn meg på å spise kl 14")).toContain("reminder");
      expect(names("lag en påminnelse om møtet")).toContain("reminder");
      expect(names("husk å ringe tannlegen i morgen")).toContain("reminder");
      expect(names("utsett den påminnelsen en time")).toContain("reminder");
    });

    it("includes budget for Norwegian spend/money phrasings", () => {
      expect(names("hvor mye har jeg brukt denne måneden?")).toContain("budget");
      expect(names("sett budsjettet mitt til 200 kr")).toContain("budget");
      expect(names("hva koster dette?")).toContain("budget");
    });

    it("includes models for Norwegian model/price phrasings", () => {
      expect(names("legg til en ny modell")).toContain("models");
      expect(names("hva er prisen per token?")).toContain("models");
    });

    it("includes settings for Norwegian settings phrasings", () => {
      expect(names("endre tidssonen min")).toContain("settings");
      expect(names("oppdater innstillingene mine")).toContain("settings");
    });

    it("includes youtube_digest for Norwegian digest phrasings", () => {
      expect(names("vis meg videoene i sammendraget")).toContain("youtube_digest");
      expect(names("demp den kanalen")).toContain("youtube_digest");
    });

    it("still gates tools out of ordinary Norwegian small talk", () => {
      expect(names("hei, hvordan går det i dag?")).toEqual(["memory"]);
    });
  });
});
