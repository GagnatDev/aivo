import { describe, expect, it } from "vitest";
import { toCachedTokens } from "./openaiProvider.js";

describe("toCachedTokens", () => {
  it("passes through a reported cache-hit count", () => {
    expect(toCachedTokens(768, 1000)).toBe(768);
  });

  it("treats an absent or malformed field as no cache hit", () => {
    expect(toCachedTokens(undefined, 1000)).toBe(0);
    expect(toCachedTokens(null, 1000)).toBe(0);
    expect(toCachedTokens(Number.NaN, 1000)).toBe(0);
  });

  it("clamps into [0, prompt_tokens] so it can only discount tokens actually sent", () => {
    expect(toCachedTokens(-5, 1000)).toBe(0);
    expect(toCachedTokens(5000, 1000)).toBe(1000);
  });
});
