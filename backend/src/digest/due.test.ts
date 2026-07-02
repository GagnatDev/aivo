import { describe, expect, it } from "vitest";
import { daysBetween, digestDue, localDate, localHour } from "./due.js";
import type { DigestLane } from "./proactivity.js";

const lane = (overrides: Partial<DigestLane> = {}): DigestLane => ({
  enabled: true,
  pausedUntil: null,
  runRequestedAt: null,
  ...overrides,
});

// 06:30 UTC on July 1st = 08:30 in Oslo (CEST, UTC+2).
const NOW = new Date("2026-07-01T06:30:00Z");

const base = {
  now: NOW,
  timezone: "Europe/Oslo",
  digestHour: 7,
  intervalDays: 1,
  lane: lane(),
  lastRunDate: "2026-06-30",
};

describe("local time helpers", () => {
  it("computes local date and hour in the configured timezone", () => {
    expect(localDate(NOW, "Europe/Oslo")).toBe("2026-07-01");
    expect(localHour(NOW, "Europe/Oslo")).toBe(8);
    // In Auckland (UTC+12) it's already past midnight into July 1st evening.
    expect(localHour(NOW, "Pacific/Auckland")).toBe(18);
  });

  it("falls back to UTC on an invalid timezone instead of throwing", () => {
    expect(localDate(NOW, "Not/AZone")).toBe("2026-07-01");
    expect(localHour(NOW, "Not/AZone")).toBe(6);
  });

  it("daysBetween is calendrical", () => {
    expect(daysBetween("2026-06-30", "2026-07-01")).toBe(1);
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
    expect(daysBetween("2026-06-24", "2026-07-01")).toBe(7);
  });
});

describe("digestDue", () => {
  it("fires the first tick at/after the configured local hour on a new day", () => {
    expect(digestDue(base)).toEqual({ due: true, reason: "scheduled" });
  });

  it("does not fire before the configured hour", () => {
    expect(digestDue({ ...base, digestHour: 9 })).toEqual({ due: false });
  });

  it("does not fire twice on the same run date", () => {
    expect(digestDue({ ...base, lastRunDate: "2026-07-01" })).toEqual({ due: false });
  });

  it("respects the interval (weekly digest waits a week)", () => {
    expect(digestDue({ ...base, intervalDays: 7, lastRunDate: "2026-06-28" })).toEqual({
      due: false,
    });
    expect(digestDue({ ...base, intervalDays: 7, lastRunDate: "2026-06-24" })).toEqual({
      due: true,
      reason: "scheduled",
    });
  });

  it("fires immediately when the digest has never run", () => {
    expect(digestDue({ ...base, lastRunDate: null })).toEqual({ due: true, reason: "scheduled" });
  });

  it("is off when the lane is disabled or paused", () => {
    expect(digestDue({ ...base, lane: lane({ enabled: false }) })).toEqual({ due: false });
    expect(
      digestDue({ ...base, lane: lane({ pausedUntil: new Date("2026-07-08T00:00:00Z") }) }),
    ).toEqual({ due: false });
  });

  it("resumes after the pause lapses", () => {
    expect(
      digestDue({ ...base, lane: lane({ pausedUntil: new Date("2026-07-01T05:00:00Z") }) }),
    ).toEqual({ due: true, reason: "scheduled" });
  });

  it("an explicit run request overrides pause, disable, hour, and watermark", () => {
    const requested = lane({
      enabled: false,
      pausedUntil: new Date("2026-08-01T00:00:00Z"),
      runRequestedAt: NOW,
    });
    expect(digestDue({ ...base, lane: requested, lastRunDate: "2026-07-01" })).toEqual({
      due: true,
      reason: "requested",
    });
  });
});
