import { describe, expect, it } from "vitest";
import { estimateRequestTokens, estimateTokens, truncateToTokens } from "./tokens.js";

describe("estimateTokens", () => {
  it("is zero for empty input and positive otherwise", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("grows monotonically with length", () => {
    expect(estimateTokens("a".repeat(100))).toBeGreaterThan(estimateTokens("a".repeat(10)));
  });
});

describe("estimateRequestTokens", () => {
  it("counts message content plus per-message overhead", () => {
    const one = estimateRequestTokens([{ role: "user", content: "hi" }]);
    const two = estimateRequestTokens([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there friend" },
    ]);
    expect(two).toBeGreaterThan(one);
  });

  it("adds overhead for tool schemas", () => {
    const withoutTools = estimateRequestTokens([{ role: "user", content: "hi" }]);
    const withTools = estimateRequestTokens(
      [{ role: "user", content: "hi" }],
      [{ name: "memory", description: "read and write memories", parameters: { type: "object" } }],
    );
    expect(withTools).toBeGreaterThan(withoutTools);
  });
});

describe("truncateToTokens", () => {
  it("leaves text that already fits unchanged", () => {
    const out = truncateToTokens("short", 100);
    expect(out).toEqual({ text: "short", truncated: false });
  });

  it("cuts text over the budget and flags it", () => {
    const long = "x".repeat(1000);
    const out = truncateToTokens(long, 10); // 10 tokens ≈ 40 chars
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(40);
    expect(estimateTokens(out.text)).toBeLessThanOrEqual(10);
  });

  it("truncates everything when the budget is zero", () => {
    const out = truncateToTokens("anything", 0);
    expect(out).toEqual({ text: "", truncated: true });
  });
});
