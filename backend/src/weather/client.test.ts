import { describe, expect, it } from "vitest";
import { parseForecast, roundCoord } from "./client.js";

// A trimmed MET Locationforecast "compact" body: two hourly steps then a 6-hourly step,
// exercising the block-preference fallbacks (1h → 6h → 12h) the parser makes.
const FIXTURE = {
  properties: {
    meta: { updated_at: "2026-07-23T05:30:00Z" },
    timeseries: [
      {
        time: "2026-07-23T06:00:00Z",
        data: {
          instant: {
            details: {
              air_temperature: 11.3,
              wind_speed: 2.4,
              wind_from_direction: 210.5,
              relative_humidity: 72.1,
            },
          },
          next_1_hours: {
            summary: { symbol_code: "clearsky_day" },
            details: { precipitation_amount: 0 },
          },
          next_6_hours: {
            summary: { symbol_code: "cloudy" },
            details: { precipitation_amount: 1.2 },
          },
        },
      },
      {
        time: "2026-07-23T12:00:00Z",
        data: {
          instant: { details: { air_temperature: 18.0 } },
          // No next_1_hours: symbol/precip must fall back to the 6-hour block.
          next_6_hours: {
            summary: { symbol_code: "rain" },
            details: { precipitation_amount: 2.5 },
          },
        },
      },
      {
        time: "2026-07-24T00:00:00Z",
        data: {
          instant: { details: {} },
          // Only a 12-hour summary this far out: symbol from it, precip null.
          next_12_hours: { summary: { symbol_code: "partlycloudy_night" } },
        },
      },
    ],
  },
};

describe("parseForecast", () => {
  it("normalizes the timeseries with block-preference fallbacks", () => {
    const f = parseForecast(59.9139, 10.7522, FIXTURE);
    expect(f.updatedAt).toBe("2026-07-23T05:30:00Z");
    expect(f.series).toHaveLength(3);

    const [first, second, third] = f.series;
    // Prefers the 1-hour block when present.
    expect(first).toMatchObject({
      temperatureC: 11.3,
      symbolCode: "clearsky_day",
      precipitationMm: 0,
    });
    expect(first?.windFromDirectionDeg).toBe(210.5);
    // Falls back to the 6-hour block.
    expect(second).toMatchObject({ temperatureC: 18, symbolCode: "rain", precipitationMm: 2.5 });
    // Falls back to the 12-hour summary for the symbol; no precip block ⇒ null.
    expect(third).toMatchObject({ symbolCode: "partlycloudy_night", precipitationMm: null });
    expect(third?.temperatureC).toBeNull();
  });

  it("tolerates an empty or malformed body", () => {
    expect(parseForecast(0, 0, {}).series).toEqual([]);
    expect(parseForecast(0, 0, { properties: { timeseries: [{}] } }).series).toEqual([]);
    expect(parseForecast(0, 0, null).series).toEqual([]);
  });
});

describe("roundCoord", () => {
  it("truncates to 4 decimals per MET's terms", () => {
    expect(roundCoord(59.913868)).toBe(59.9139);
    expect(roundCoord(10.75225)).toBe(10.7523);
  });
});
