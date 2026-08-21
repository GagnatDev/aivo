// HTTP client for MET Norway's Locationforecast 2.0 API (https://developer.yr.no,
// api.met.no/weatherapi/locationforecast/2.0). Free, keyless, but the terms require a
// User-Agent that identifies the application, and coordinates truncated to <=4 decimals
// (better cache hits). The network impl lives behind the WeatherClient interface so the
// agent tool and the morning-report runner are testable against a fake
// (test/fakeWeather.ts); only the pure parser is unit-tested against fixtures.

/** One forecast step, normalized from a MET timeseries entry. Fields are null when the
 * source omits them (further-out steps drop the fine-grained blocks). */
export interface ForecastInstant {
  /** ISO-8601 instant (UTC) the step applies from. */
  time: string;
  temperatureC: number | null;
  windSpeedMps: number | null;
  windFromDirectionDeg: number | null;
  humidityPct: number | null;
  /** MET symbol code ("clearsky_day", "rain", …), from the shortest available block. */
  symbolCode: string | null;
  /** Precipitation over the step's block (next_1_hours if present, else next_6_hours). */
  precipitationMm: number | null;
}

/** A parsed forecast: metadata plus the normalized timeseries (oldest first). Daily and
 * "current" views are derived in weather/format.ts, which knows the user's timezone. */
export interface Forecast {
  updatedAt: string | null;
  latitude: number;
  longitude: number;
  series: ForecastInstant[];
}

export interface WeatherClient {
  /** Forecast for a coordinate. lat/lon are rounded to 4 decimals per MET's terms. */
  getForecast(latitude: number, longitude: number): Promise<Forecast>;
}

/** A non-2xx response from MET (e.g. 400 bad coordinates, 429 throttled, 5xx). */
export class WeatherApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WeatherApiError";
  }
}

/** A forecast request that exceeded the configured timeout (mirrors the unforked client:
 * a bounded timeout turns a wedged upstream into a prompt, honest failure the tool can
 * report instead of hanging the agent turn on undici's multi-minute default). */
export class WeatherTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`MET Norway did not respond within ${timeoutMs}ms`);
    this.name = "WeatherTimeoutError";
  }
}

export const DEFAULT_WEATHER_TIMEOUT_MS = 10_000;

export interface WeatherClientConfig {
  /** e.g. https://api.met.no/weatherapi/locationforecast/2.0 (no trailing slash needed). */
  baseUrl: string;
  /** Identifies the app to MET — required by their terms (WEATHER_USER_AGENT). */
  userAgent: string;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_WEATHER_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Round a coordinate to 4 decimals — MET's terms ask for at most 4 (cache hit rate). */
export function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Shape of the bits of the MET compact response we read (the rest is ignored). */
interface MetResponse {
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: Array<{
      time?: string;
      data?: {
        instant?: {
          details?: {
            air_temperature?: number;
            wind_speed?: number;
            wind_from_direction?: number;
            relative_humidity?: number;
          };
        };
        next_1_hours?: {
          summary?: { symbol_code?: string };
          details?: { precipitation_amount?: number };
        };
        next_6_hours?: {
          summary?: { symbol_code?: string };
          details?: { precipitation_amount?: number };
        };
        next_12_hours?: { summary?: { symbol_code?: string } };
      };
    }>;
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Parse a MET Locationforecast "compact" JSON body into a {@link Forecast}. Pure — no
 * network — so it is unit-tested against a fixture. Each step's symbol code prefers the
 * shortest available block (1h → 6h → 12h) and precipitation the shortest (1h → 6h),
 * matching how yr.no itself surfaces near-term detail.
 */
export function parseForecast(latitude: number, longitude: number, body: unknown): Forecast {
  const props = (body as MetResponse | null)?.properties;
  const series: ForecastInstant[] = (props?.timeseries ?? []).flatMap((entry) => {
    if (!entry.time) return [];
    const inst = entry.data?.instant?.details;
    const h1 = entry.data?.next_1_hours;
    const h6 = entry.data?.next_6_hours;
    const h12 = entry.data?.next_12_hours;
    return [
      {
        time: entry.time,
        temperatureC: num(inst?.air_temperature),
        windSpeedMps: num(inst?.wind_speed),
        windFromDirectionDeg: num(inst?.wind_from_direction),
        humidityPct: num(inst?.relative_humidity),
        symbolCode:
          h1?.summary?.symbol_code ?? h6?.summary?.symbol_code ?? h12?.summary?.symbol_code ?? null,
        precipitationMm:
          num(h1?.details?.precipitation_amount) ?? num(h6?.details?.precipitation_amount),
      },
    ];
  });
  return { updatedAt: props?.meta?.updated_at ?? null, latitude, longitude, series };
}

export function createWeatherClient(config: WeatherClientConfig): WeatherClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_WEATHER_TIMEOUT_MS;

  return {
    async getForecast(latitude, longitude): Promise<Forecast> {
      const lat = roundCoord(latitude);
      const lon = roundCoord(longitude);
      let res: Response;
      try {
        res = await fetch(`${base}/compact?lat=${lat}&lon=${lon}`, {
          headers: { "User-Agent": config.userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new WeatherTimeoutError(timeoutMs);
        }
        throw err;
      }
      if (!res.ok) {
        throw new WeatherApiError(res.status, `MET Norway responded ${res.status}`);
      }
      return parseForecast(lat, lon, await res.json());
    },
  };
}
