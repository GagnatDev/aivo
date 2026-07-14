import { describe, expect, it } from "vitest";
import { gateMatches, tokenize, withinEditDistance } from "./gate.js";

describe("tokenize", () => {
  it("lowercases and keeps Unicode letters, splitting on punctuation", () => {
    expect(tokenize("Hva står på handlelista, à la carte?")).toEqual([
      "hva",
      "står",
      "på",
      "handlelista",
      "à",
      "la",
      "carte",
    ]);
  });
});

describe("withinEditDistance", () => {
  it("counts substitutions, insertions and deletions up to the budget", () => {
    expect(withinEditDistance("handeliste", "handleliste", 2)).toBe(true); // one deletion
    expect(withinEditDistance("handleliste", "handleliste", 0)).toBe(true);
    expect(withinEditDistance("cat", "dog", 2)).toBe(false);
    expect(withinEditDistance("kitten", "sitting", 2)).toBe(false); // distance 3
  });
});

describe("gateMatches", () => {
  it("matches exact and stemmed words", () => {
    expect(gateMatches(["middag"], "hva blir middagen i dag?")).toBe(true);
    expect(gateMatches(["remind"], "what reminders exist?")).toBe(true);
  });

  it("tolerates typos and transcription slips scaled to word length", () => {
    // The reported incident: a voice transcription dropped an 'l'.
    expect(gateMatches(["handleliste"], "legg på næste uges handeliste")).toBe(true);
    expect(gateMatches(["handleliste"], "vis handlelista for neste uke")).toBe(true);
    expect(gateMatches(["reminder"], "set a remidner please")).toBe(true);
    // A short trigger stays near-exact so it doesn't fire on everything.
    expect(gateMatches(["mat"], "matematikk er gøy")).toBe(false);
    expect(gateMatches(["mat"], "har vi mat igjen?")).toBe(true);
  });

  it("matches multi-word phrases when every part is present", () => {
    expect(gateMatches(["shopping list"], "add milk to the shopping list")).toBe(true);
    expect(gateMatches(["time zone"], "change my time zone")).toBe(true);
    expect(gateMatches(["per token"], "hva er prisen per token?")).toBe(true);
    expect(gateMatches(["shopping list"], "I went shopping today")).toBe(false);
  });

  it("matches bare symbol triggers as literals", () => {
    expect(gateMatches(["$", "€"], "set my cap to $20")).toBe(true);
    expect(gateMatches(["$", "€"], "budsjett på 200 €")).toBe(true);
    expect(gateMatches(["$", "€"], "no currency here")).toBe(false);
  });

  it("does not fire on unrelated small talk", () => {
    expect(gateMatches(["middag", "handleliste", "oppskrift"], "hei, hvordan går det i dag?")).toBe(
      false,
    );
  });
});
