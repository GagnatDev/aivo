import type { AgentDeps } from "../agent/deps.js";
import { logger } from "../logger.js";
import type { WeatherClient } from "./client.js";
import { morningReportText } from "./format.js";

/**
 * The morning weather report's business logic, split from the Discord delivery so it is
 * testable against the DB + a fake WeatherClient (mirrors digest/pipeline.ts vs
 * discord/digestDelivery.ts). Resolves the owner's home location, fetches its forecast,
 * and renders the templated push text. Never throws: an upstream failure becomes an
 * `error` outcome the deliverer reports honestly rather than a crashed scheduler tick.
 */
export type WeatherReportOutcome =
  | { kind: "report"; locationName: string; text: string }
  | { kind: "no_home" }
  | { kind: "error"; message: string };

export async function runWeatherReport(
  deps: AgentDeps,
  weather: WeatherClient,
  userId: string,
  now: Date,
): Promise<WeatherReportOutcome> {
  const home = await deps.weatherLocations.getHome(userId);
  if (!home) return { kind: "no_home" };
  const settings = await deps.settings.getOrCreate(userId);
  try {
    const forecast = await weather.getForecast(home.latitude, home.longitude);
    return {
      kind: "report",
      locationName: home.name,
      text: morningReportText(home.name, forecast, settings.timezone, now),
    };
  } catch (err) {
    logger.error({ err, userId, location: home.name }, "weather report fetch failed");
    return { kind: "error", message: err instanceof Error ? err.message : "unknown error" };
  }
}
