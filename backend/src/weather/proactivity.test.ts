import { describe, expect, it } from "vitest";
import { parseWeatherLane, withWeatherLane } from "./proactivity.js";

describe("weather proactivity lane", () => {
  it("defaults to off at hour 6 when absent or malformed", () => {
    expect(parseWeatherLane({})).toEqual({
      enabled: false,
      reportHour: 6,
      lastReportDate: null,
      runRequestedAt: null,
    });
    expect(parseWeatherLane({ weather: { report_hour: 99 } }).reportHour).toBe(6);
  });

  it("round-trips through withWeatherLane and leaves other lanes untouched", () => {
    const start = { digest: { enabled: true } };
    const merged = withWeatherLane(start, {
      enabled: true,
      reportHour: 7,
      runRequestedAt: new Date("2026-07-23T04:00:00Z"),
    });
    expect(merged.digest).toEqual({ enabled: true });

    const lane = parseWeatherLane(merged);
    expect(lane.enabled).toBe(true);
    expect(lane.reportHour).toBe(7);
    expect(lane.runRequestedAt).toEqual(new Date("2026-07-23T04:00:00Z"));
  });
});
