import { describe, expect, it } from "vitest";
import { buildStage2Messages, parseStage2Response, TRANSCRIPT_CHAR_CAP } from "./summarize.js";

const video = {
  title: "Dovetails by hand",
  channelTitle: "Wood",
  description: "hand tool joinery",
  durationSeconds: 900,
};

describe("buildStage2Messages", () => {
  it("caps the transcript so one outlier can't blow up a run", () => {
    const [, user] = buildStage2Messages({
      profileBody: "likes woodworking",
      video,
      transcript: "t".repeat(TRANSCRIPT_CHAR_CAP + 5000),
      brief: false,
    });
    expect((user.content ?? "").length).toBeLessThan(TRANSCRIPT_CHAR_CAP + 1000);
  });

  it("asks for a metadata-only judgement when there is no transcript", () => {
    const [, user] = buildStage2Messages({
      profileBody: "p",
      video,
      transcript: null,
      brief: false,
    });
    expect(user.content).toMatch(/No transcript is available/);
  });

  it("asks for a single bullet in brief (degraded) mode", () => {
    const [system] = buildStage2Messages({ profileBody: "p", video, transcript: "t", brief: true });
    expect(system.content).toMatch(/exactly 1 short bullet/);
  });
});

describe("parseStage2Response", () => {
  it("parses a pick with summary and why", () => {
    const verdict = parseStage2Response(
      '{"decision":"pick","confidence":0.85,"summary":["covers half-blind dovetails","tool list included"],"why":"matches your hand-tool interest"}',
    );
    expect(verdict).toEqual({
      decision: "pick",
      confidence: 0.85,
      summaryBullets: ["covers half-blind dovetails", "tool list included"],
      why: "matches your hand-tool interest",
      reason: null,
    });
  });

  it("parses a reject with a reason and clamps confidence", () => {
    const verdict = parseStage2Response(
      'Sure: {"decision":"reject","confidence":7,"reason":"news recap"}',
    );
    expect(verdict?.decision).toBe("reject");
    expect(verdict?.confidence).toBe(1);
    expect(verdict?.reason).toBe("news recap");
  });

  it("returns undefined for unusable responses", () => {
    expect(parseStage2Response(null)).toBeUndefined();
    expect(parseStage2Response("not json")).toBeUndefined();
    expect(parseStage2Response('{"decision":"maybe"}')).toBeUndefined();
  });
});
