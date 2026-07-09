import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.js";

describe("diffLines", () => {
  it("marks unchanged, added, and removed lines", () => {
    const before = "likes space\nno news recaps\nlong-form only";
    const after = "likes space\nlikes biology\nlong-form only";
    expect(diffLines(before, after)).toEqual([
      { kind: "same", text: "likes space" },
      { kind: "removed", text: "no news recaps" },
      { kind: "added", text: "likes biology" },
      { kind: "same", text: "long-form only" },
    ]);
  });

  it("handles pure additions and pure removals at the edges", () => {
    expect(diffLines("a", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(diffLines("a\nb", "b")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("treats identical texts as all-same", () => {
    expect(diffLines("x\ny", "x\ny")).toEqual([
      { kind: "same", text: "x" },
      { kind: "same", text: "y" },
    ]);
  });
});
