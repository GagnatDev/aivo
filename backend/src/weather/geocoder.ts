// HTTP client for OpenStreetMap's Nominatim geocoder — MET Norway's forecast API takes
// only coordinates, so a place name ("Trondheim") is resolved to lat/lon here first.
// Nominatim is free and keyless but its usage policy requires a descriptive User-Agent
// and low request volume; Aivo geocodes only on an explicit lookup or when saving a
// location (then caches the coordinates in weather_locations), so volume stays tiny.
// Behind the Geocoder interface for a testable fake (test/fakeWeather.ts).

export interface GeocodeResult {
  /** Human-readable resolved name, e.g. "Trondheim, Trøndelag, Norway". */
  name: string;
  latitude: number;
  longitude: number;
}

export interface Geocoder {
  /** Resolve a free-form place query to its best match, or null if nothing matched. */
  search(query: string): Promise<GeocodeResult | null>;
}

export class GeocoderApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeocoderApiError";
  }
}

export class GeocoderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Geocoder did not respond within ${timeoutMs}ms`);
    this.name = "GeocoderTimeoutError";
  }
}

export const DEFAULT_GEOCODER_TIMEOUT_MS = 10_000;

export interface GeocoderConfig {
  /** e.g. https://nominatim.openstreetmap.org (no trailing slash needed). */
  baseUrl: string;
  /** Identifies the app — required by Nominatim's usage policy (WEATHER_USER_AGENT). */
  userAgent: string;
  timeoutMs?: number;
}

/** The subset of a Nominatim jsonv2 hit we read. lat/lon arrive as strings. */
interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
}

/** Parse a Nominatim jsonv2 array into the best {@link GeocodeResult}, or null. Pure. */
export function parseGeocode(body: unknown): GeocodeResult | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const hit = body[0] as NominatimHit;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { name: hit.display_name ?? "", latitude, longitude };
}

export function createGeocoder(config: GeocoderConfig): Geocoder {
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_GEOCODER_TIMEOUT_MS;

  return {
    async search(query): Promise<GeocodeResult | null> {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": config.userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new GeocoderTimeoutError(timeoutMs);
        }
        throw err;
      }
      if (!res.ok) {
        throw new GeocoderApiError(res.status, `Geocoder responded ${res.status}`);
      }
      return parseGeocode(await res.json());
    },
  };
}
