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
});
