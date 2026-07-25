import type { Forecast, ForecastInstant, WeatherClient } from "../weather/client.js";
import type { GeocodeResult, Geocoder } from "../weather/geocoder.js";

/** Build a ForecastInstant with sensible defaults; override the fields a test cares about. */
export function fakeInstant(over: Partial<ForecastInstant> & { time: string }): ForecastInstant {
  return {
    temperatureC: 12,
    windSpeedMps: 3,
    windFromDirectionDeg: 180,
    humidityPct: 60,
    symbolCode: "cloudy",
    precipitationMm: 0,
    ...over,
  };
}

/** A small default forecast: hourly steps from 06:00Z with a bit of afternoon rain. */
export function fakeForecast(over: Partial<Forecast> = {}): Forecast {
  const series: ForecastInstant[] = [
    fakeInstant({ time: "2026-07-23T06:00:00Z", temperatureC: 11, symbolCode: "clearsky_day" }),
    fakeInstant({ time: "2026-07-23T09:00:00Z", temperatureC: 15, symbolCode: "fair_day" }),
    fakeInstant({ time: "2026-07-23T12:00:00Z", temperatureC: 18, symbolCode: "partlycloudy_day" }),
    fakeInstant({
      time: "2026-07-23T15:00:00Z",
      temperatureC: 17,
      symbolCode: "rain",
      precipitationMm: 1.4,
    }),
    fakeInstant({ time: "2026-07-24T09:00:00Z", temperatureC: 14, symbolCode: "cloudy" }),
  ];
  return {
    updatedAt: "2026-07-23T05:30:00Z",
    latitude: 59.9139,
    longitude: 10.7522,
    series,
    ...over,
  };
}

export interface FakeWeatherClient extends WeatherClient {
  /** Coordinates passed to the most recent getForecast call. */
  lastCall: { latitude: number; longitude: number } | null;
}

/** A WeatherClient returning a fixed forecast (or throwing `error`), recording its call. */
export function makeFakeWeather(
  forecast: Forecast = fakeForecast(),
  error?: Error,
): FakeWeatherClient {
  return {
    lastCall: null,
    async getForecast(latitude, longitude) {
      this.lastCall = { latitude, longitude };
      if (error) throw error;
      return { ...forecast, latitude, longitude };
    },
  };
}

/**
 * A Geocoder resolving from a case-insensitive query→result map; unknown queries return
 * null (or the whole call throws when `error` is set). Defaults to knowing "oslo".
 */
export function makeFakeGeocoder(
  results: Record<string, GeocodeResult> = {
    oslo: { name: "Oslo, Norway", latitude: 59.9139, longitude: 10.7522 },
  },
  error?: Error,
): Geocoder {
  const byKey = new Map(Object.entries(results).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    async search(query) {
      if (error) throw error;
      return byKey.get(query.trim().toLowerCase()) ?? null;
    },
  };
}
