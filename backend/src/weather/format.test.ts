import { describe, expect, it } from "vitest";
import { fakeForecast } from "../test/fakeWeather.js";
import {
  compass,
  dailyBuckets,
  morningReportText,
  summarizeForecast,
  symbolEmoji,
  symbolLabel,
} from "./format.js";

const TZ = "Europe/Oslo"; // summer UTC+2

describe("symbol rendering", () => {
  it("labels codes with day/night and thunder handling", () => {
    expect(symbolLabel("clearsky_day")).toBe("Clear sky");
    expect(symbolLabel("partlycloudy_night")).toBe("Partly cloudy");
    expect(symbolLabel("heavyrain")).toBe("Heavy rain");
    expect(symbolLabel("rainshowersandthunder_day")).toBe("Rain showers with thunder");
    // Unknown code still prettifies rather than blanking.
    expect(symbolLabel("somenewcode_day")).toBe("Somenewcode");
    expect(symbolLabel(null)).toBe("—");
  });

  it("picks day/night aware emoji", () => {
    expect(symbolEmoji("clearsky_day")).toBe("☀️");
    expect(symbolEmoji("clearsky_night")).toBe("🌙");
    expect(symbolEmoji("rain")).toBe("🌧️");
    expect(symbolEmoji("rainshowers_day")).toBe("🌦️");
    expect(symbolEmoji("snow")).toBe("🌨️");
  });
});

describe("compass", () => {
  it("maps degrees to 8-point compass, wrapping at 360", () => {
    expect(compass(0)).toBe("N");
    expect(compass(90)).toBe("E");
    expect(compass(200)).toBe("S");
    expect(compass(360)).toBe("N");
    expect(compass(null)).toBe("");
  });
});

describe("dailyBuckets", () => {
  it("buckets steps by local date with min/max temp and summed precip", () => {
    const days = dailyBuckets(fakeForecast(), TZ);
    expect(days.map((d) => d.date)).toEqual(["2026-07-23", "2026-07-24"]);
    const first = days[0];
    expect(first?.minTempC).toBe(11);
    expect(first?.maxTempC).toBe(18);
    expect(first?.precipitationMm).toBeCloseTo(1.4);
  });
});

describe("summarizeForecast", () => {
  it("renders current, upcoming hours, and day sections", () => {
    const text = summarizeForecast("Oslo", fakeForecast(), TZ);
    expect(text).toContain("Forecast for Oslo");
    expect(text).toContain("Now:");
    expect(text).toContain("Next hours:");
    expect(text).toContain("Days:");
    // 15:00Z rain step shows in local time (17:00 in summer Oslo).
    expect(text).toContain("17:00");
  });

  it("handles an empty forecast gracefully", () => {
    const text = summarizeForecast("Nowhere", fakeForecast({ series: [] }), TZ);
    expect(text).toBe("No forecast data available for Nowhere.");
  });
});

describe("morningReportText", () => {
  it("builds the greeting, today, daytime hours, and tomorrow", () => {
    const now = new Date("2026-07-23T04:00:00Z"); // 06:00 local
    const text = morningReportText("Oslo", fakeForecast(), TZ, now);
    expect(text).toContain("Good morning! Weather for Oslo");
    expect(text).toContain("**Now:**");
    expect(text).toContain("**Today:**");
    expect(text).toContain("**Tomorrow:**");
    // 12:00Z daytime step surfaces at 14:00 local.
    expect(text).toContain("14:00");
  });
});
