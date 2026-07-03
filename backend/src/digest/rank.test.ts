import { describe, expect, it } from "vitest";
import { buildStage1Messages, parseStage1Response, STAGE1_FALLBACK_SCORE } from "./rank.js";

const candidates = [
  {
    id: "v1",
    title: "Dovetails by hand",
    channelTitle: "Wood",
    description: "x".repeat(500),
    durationSeconds: 900,
  },
  { id: "v2", title: "News recap", channelTitle: "News", description: "", durationSeconds: null },
];

describe("buildStage1Messages", () => {
  it("includes the profile and truncated candidate metadata", () => {
    const [system, user] = buildStage1Messages("likes woodworking", candidates);
    expect(system.content).toMatch(/JSON array/);
    expect(user.content).toMatch(/likes woodworking/);
    expect(user.content).toMatch(/Dovetails/);
    // Descriptions are capped so the cheap-stage prompt stays bounded.
    expect(user.content?.includes("x".repeat(301))).toBe(false);
  });
});

describe("parseStage1Response", () => {
  it("parses scores, clamps to [0,1], and keeps reasons", () => {
    const text =
      'Here you go: [{"id":"v1","score":1.4,"reason":""},{"id":"v2","score":0.1,"reason":"news recap, you said no"}]';
    expect(parseStage1Response(text, ["v1", "v2"])).toEqual([
      { id: "v1", score: 1, reason: null },
      { id: "v2", score: 0.1, reason: "news recap, you said no" },
    ]);
  });

  it("drops unknown ids and backfills omitted candidates with the neutral score", () => {
    const text = '[{"id":"bogus","score":0.9},{"id":"v1","score":0.8}]';
    expect(parseStage1Response(text, ["v1", "v2"])).toEqual([
      { id: "v1", score: 0.8, reason: null },
      { id: "v2", score: STAGE1_FALLBACK_SCORE, reason: null },
    ]);
  });

  it("degrades an unparsable response to neutral scores for every candidate", () => {
    for (const bad of [null, "no json here", "[{broken"]) {
      const scores = parseStage1Response(bad, ["v1", "v2"]);
      expect(scores.every((s) => s.score === STAGE1_FALLBACK_SCORE)).toBe(true);
    }
  });
});
