import { describe, expect, it } from "vitest";
import type { WeatherLane } from "./proactivity.js";
import { weatherReportDue } from "./due.js";

const TZ = "Europe/Oslo"; // summer: UTC+2
const lane = (over: Partial<WeatherLane> = {}): WeatherLane => ({
  enabled: true,
  reportHour: 6,
  lastReportDate: null,
  runRequestedAt: null,
  ...over,
});

describe("weatherReportDue", () => {
  it("a requested run always fires, overriding disabled", () => {
    const at = new Date("2026-07-23T00:00:00Z"); // 02:00 local, before the hour
    const result = weatherReportDue({
      now: at,
      timezone: TZ,
      lane: lane({ enabled: false, runRequestedAt: at }),
    });
    expect(result).toEqual({ due: true, reason: "requested" });
  });

  it("is not due when disabled", () => {
    const at = new Date("2026-07-23T06:00:00Z"); // 08:00 local
    expect(weatherReportDue({ now: at, timezone: TZ, lane: lane({ enabled: false }) })).toEqual({
      due: false,
    });
  });

  it("waits for the local delivery hour", () => {
    // 05:30 local is before hour 6.
    expect(
      weatherReportDue({ now: new Date("2026-07-23T03:30:00Z"), timezone: TZ, lane: lane() }),
    ).toEqual({ due: false });
    // 06:10 local is at/after hour 6.
    expect(
      weatherReportDue({ now: new Date("2026-07-23T04:10:00Z"), timezone: TZ, lane: lane() }),
    ).toEqual({ due: true, reason: "scheduled" });
  });

  it("fires at most once per local day via the watermark", () => {
    const at = new Date("2026-07-23T05:00:00Z"); // 07:00 local on 2026-07-23
    expect(
      weatherReportDue({ now: at, timezone: TZ, lane: lane({ lastReportDate: "2026-07-23" }) }),
    ).toEqual({ due: false });
    expect(
      weatherReportDue({ now: at, timezone: TZ, lane: lane({ lastReportDate: "2026-07-22" }) }),
    ).toEqual({ due: true, reason: "scheduled" });
  });
});
