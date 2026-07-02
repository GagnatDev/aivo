import { describe, expect, it } from "vitest";
import { estimateRequestTokens, estimateTokens } from "./tokens.js";

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
