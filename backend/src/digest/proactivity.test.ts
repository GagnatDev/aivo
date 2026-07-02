import { describe, expect, it } from "vitest";
import { parseDigestLane, withDigestLane } from "./proactivity.js";

describe("parseDigestLane", () => {
  it("defaults to enabled with no pause on an empty object", () => {
    expect(parseDigestLane({})).toEqual({
      enabled: true,
      pausedUntil: null,
      runRequestedAt: null,
    });
  });

  it("round-trips a lane written by withDigestLane", () => {
    const until = new Date("2026-07-08T05:00:00Z");
    const stored = withDigestLane({}, { enabled: false, pausedUntil: until });
    const lane = parseDigestLane(stored);
    expect(lane.enabled).toBe(false);
    expect(lane.pausedUntil?.toISOString()).toBe(until.toISOString());
  });

  it("treats malformed lane data as defaults instead of throwing", () => {
    expect(parseDigestLane({ digest: { enabled: "yes", paused_until: 42 } }).enabled).toBe(true);
  });
});

describe("withDigestLane", () => {
  it("preserves other proactivity lanes", () => {
    const stored = withDigestLane({ reminders: { enabled: false } }, { enabled: false });
    expect(stored.reminders).toEqual({ enabled: false });
  });

  it("patches only the given fields", () => {
    const paused = withDigestLane({}, { pausedUntil: new Date("2026-07-08T05:00:00Z") });
    const resumed = withDigestLane(paused, { pausedUntil: null });
    const lane = parseDigestLane(resumed);
    expect(lane.enabled).toBe(true);
    expect(lane.pausedUntil).toBeNull();
  });
});
