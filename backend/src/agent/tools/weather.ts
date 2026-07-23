import { z } from "zod";
import { WeatherApiError, WeatherTimeoutError } from "../../weather/client.js";
import { summarizeForecast } from "../../weather/format.js";
import { GeocoderApiError, GeocoderTimeoutError } from "../../weather/geocoder.js";
import { parseWeatherLane, withWeatherLane } from "../../weather/proactivity.js";
import { OWNER_ONLY, parse, type AgentTool, type ToolContext } from "./index.js";

/**
 * The chat control surface for weather (MET Norway / yr.no): a forecast for any place
 * (by saved name, free-form name via the geocoder, or explicit coordinates), a per-user
 * list of saved locations, and the owner-configured daily morning report. Forecasts and
 * saved locations are per-user; the morning report (a proactive push to the home
 * channel, like the YouTube digest) is OWNER-ONLY — enforced here, never via prompt
 * text. Delivery itself is the scheduler's job (scheduler/tick.ts + discord/
 * weatherDelivery.ts); this tool only reads forecasts and edits config/locations.
 */

const weatherArgs = z.object({
  action: z.enum([
    "forecast",
    "list_locations",
    "add_location",
    "remove_location",
    "set_home",
    "configure_report",
    "report_status",
    "run_report_now",
  ]),
  /** Place to forecast (action=forecast): a saved name or a free-form name. */
  location: z.string().min(1).optional(),
  /** Explicit coordinates (action=forecast), an alternative to `location`. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Saved-location name (action=add/remove/set_home). */
  name: z.string().min(1).optional(),
  /** Geocoder search string for add_location when it differs from `name`. */
  query: z.string().min(1).optional(),
  /** Local delivery hour 0-23 for the morning report (action=configure_report). */
  report_hour: z.number().int().min(0).max(23).optional(),
  /** Turn the morning report on/off (action=configure_report). */
  enabled: z.boolean().optional(),
});

type WeatherArgs = z.infer<typeof weatherArgs>;

export const weatherTool: AgentTool = {
  // Bilingual keyword gate (English + Norwegian, the owner's usual language) — see
  // reminders.ts and gate.ts.
  gate: [
    "weather",
    "forecast",
    "temperature",
    "rain",
    "snow",
    "wind",
    "yr",
    "location",
    "vær",
    "værmelding",
    "temperatur",
    // Not "regn": it stem-matches "regnet" (calculated), a false trigger in ordinary
    // Norwegian. "nedbør" (precipitation) carries the rain sense unambiguously.
    "nedbør",
    "snø",
    "vind",
    "sol",
    "prognose",
    "sted",
  ],
  schema: {
    name: "weather",
    description:
      "Check the weather forecast (MET Norway / yr.no) and manage weather locations and the " +
      "daily morning report. Call this whenever the user asks about the weather, forecast, " +
      "temperature, rain/snow/wind ('what's the weather in X?', 'hvordan blir været i morgen?'), " +
      "or wants to manage saved places or the morning report. Actions: 'forecast' (location = a " +
      "saved name or any place name, OR latitude+longitude); 'list_locations'; 'add_location' " +
      "(name to save it under, optional query if the search text differs) — geocodes and stores it; " +
      "'remove_location' (name); 'set_home' (name — the place the morning report uses); " +
      "'configure_report' (report_hour 0-23 and/or enabled — turn the daily morning report on/off); " +
      "'report_status'; 'run_report_now' (deliver a weather report within a minute). set_home, " +
      "configure_report, and run_report_now are OWNER-ONLY. Forecasts and saved locations are " +
      "per-user.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "forecast",
            "list_locations",
            "add_location",
            "remove_location",
            "set_home",
            "configure_report",
            "report_status",
            "run_report_now",
          ],
        },
        location: { type: "string", description: "place to forecast (saved or free-form name)" },
        latitude: { type: "number", description: "latitude for a coordinate forecast" },
        longitude: { type: "number", description: "longitude for a coordinate forecast" },
        name: { type: "string", description: "saved-location name (add/remove/set_home)" },
        query: { type: "string", description: "geocoder search text (add_location, if != name)" },
        report_hour: { type: "integer", description: "local hour 0-23 for the morning report" },
        enabled: { type: "boolean", description: "turn the morning report on/off" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(weatherArgs, args);
    if (!p.ok) return p.error;
    const a = p.value;

    switch (a.action) {
      case "forecast":
        return forecast(ctx, a);
      case "list_locations":
        return listLocations(ctx);
      case "add_location":
        return addLocation(ctx, a);
      case "remove_location": {
        if (!a.name) return "Provide the location 'name' to remove.";
        const row = await ctx.deps.weatherLocations.remove(ctx.userId, a.name);
        return row
          ? `Removed saved location "${row.name}".`
          : `You have no saved location called "${a.name}".`;
      }
      case "report_status":
        return reportStatus(ctx);
      // Owner-only from here down (the morning report is a shared proactive push).
      case "set_home":
        return withOwner(ctx, () => setHome(ctx, a));
      case "configure_report":
        return withOwner(ctx, () => configureReport(ctx, a));
      case "run_report_now":
        return withOwner(ctx, () => runReportNow(ctx));
    }
  },
};

/** Run an owner-only action, or return the standard refusal for non-owners. */
function withOwner(ctx: ToolContext, fn: () => Promise<string>): Promise<string> {
  return ctx.isOwner ? fn() : Promise.resolve(OWNER_ONLY);
}

async function forecast(ctx: ToolContext, a: WeatherArgs): Promise<string> {
  if (!ctx.deps.weather) return "Weather lookups aren't configured right now.";
  const target = await resolveTarget(ctx, a);
  if (typeof target === "string") return target;
  let summary: string;
  try {
    const f = await ctx.deps.weather.getForecast(target.latitude, target.longitude);
    const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
    summary = summarizeForecast(target.name, f, settings.timezone);
  } catch (err) {
    return weatherError(err);
  }
  return summary;
}

interface Target {
  name: string;
  latitude: number;
  longitude: number;
}

/** Resolve a forecast target from coordinates, a saved name, or a geocoded name. */
async function resolveTarget(ctx: ToolContext, a: WeatherArgs): Promise<Target | string> {
  if (a.latitude !== undefined && a.longitude !== undefined) {
    return {
      name: a.location ?? `${a.latitude}, ${a.longitude}`,
      latitude: a.latitude,
      longitude: a.longitude,
    };
  }
  if (!a.location) return "Give a location name, or latitude and longitude.";
  const saved = await ctx.deps.weatherLocations.findByName(ctx.userId, a.location);
  if (saved) return { name: saved.name, latitude: saved.latitude, longitude: saved.longitude };
  if (!ctx.deps.geocoder) {
    return `I can only forecast your saved locations or explicit coordinates right now — "${a.location}" isn't saved and geocoding isn't configured.`;
  }
  try {
    const hit = await ctx.deps.geocoder.search(a.location);
    if (!hit) return `I couldn't find a place called "${a.location}".`;
    return { name: hit.name || a.location, latitude: hit.latitude, longitude: hit.longitude };
  } catch (err) {
    return geocodeError(err);
  }
}

async function listLocations(ctx: ToolContext): Promise<string> {
  const rows = await ctx.deps.weatherLocations.list(ctx.userId);
  if (rows.length === 0) return "You have no saved weather locations yet.";
  return JSON.stringify(
    rows.map((r) => ({ name: r.name, is_home: r.is_home, resolved: r.display_name })),
  );
}

async function addLocation(ctx: ToolContext, a: WeatherArgs): Promise<string> {
  if (!a.name) return "Provide a 'name' to save the location under.";
  if (!ctx.deps.geocoder) return "I can't add locations right now — geocoding isn't configured.";
  let hit: Awaited<ReturnType<NonNullable<ToolContext["deps"]["geocoder"]>["search"]>>;
  try {
    hit = await ctx.deps.geocoder.search(a.query ?? a.name);
  } catch (err) {
    return geocodeError(err);
  }
  if (!hit) return `I couldn't find a place called "${a.query ?? a.name}" to save.`;
  const row = await ctx.deps.weatherLocations.upsert(ctx.userId, {
    name: a.name,
    latitude: hit.latitude,
    longitude: hit.longitude,
    displayName: hit.name,
  });
  return `Saved "${row.name}" (${hit.name}). Ask me for its forecast any time.`;
}

async function setHome(ctx: ToolContext, a: WeatherArgs): Promise<string> {
  if (!a.name) return "Provide the 'name' of a saved location to set as home.";
  const row = await ctx.deps.weatherLocations.setHome(ctx.userId, a.name);
  if (!row)
    return `You have no saved location called "${a.name}" — add it first, then set it as home.`;
  return `Home set to "${row.name}". The daily morning report will use it (enable it with configure_report if it's off).`;
}

async function configureReport(ctx: ToolContext, a: WeatherArgs): Promise<string> {
  if (a.report_hour === undefined && a.enabled === undefined) {
    return "Provide report_hour and/or enabled.";
  }
  const patch: Parameters<typeof withWeatherLane>[1] = {};
  if (a.report_hour !== undefined) patch.reportHour = a.report_hour;
  if (a.enabled !== undefined) patch.enabled = a.enabled;
  const lane = await saveLane(ctx, patch);
  const home = await ctx.deps.weatherLocations.getHome(ctx.userId);
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  const state = lane.enabled ? `on at ${lane.reportHour}:00 ${settings.timezone}` : "off";
  const homeNote =
    lane.enabled && !home
      ? " No home location is set yet — set one so I know where to report."
      : "";
  return `Morning weather report is ${state}.${homeNote}`;
}

async function runReportNow(ctx: ToolContext): Promise<string> {
  const home = await ctx.deps.weatherLocations.getHome(ctx.userId);
  if (!home) return "Set a home location first (set_home) so I know where to report.";
  await saveLane(ctx, { runRequestedAt: ctx.deps.clock.now() });
  return `Weather report for "${home.name}" requested — it will arrive within a minute.`;
}

async function reportStatus(ctx: ToolContext): Promise<string> {
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  const lane = parseWeatherLane(settings.proactivity);
  const home = await ctx.deps.weatherLocations.getHome(ctx.userId);
  return JSON.stringify({
    enabled: lane.enabled,
    delivery_hour_local: lane.reportHour,
    timezone: settings.timezone,
    home_location: home?.name ?? null,
    last_report_date: lane.lastReportDate,
  });
}

/** Merge a weather-lane patch into settings and return the resulting lane. */
async function saveLane(ctx: ToolContext, patch: Parameters<typeof withWeatherLane>[1]) {
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  const updated = await ctx.deps.settings.update(ctx.userId, {
    proactivity: withWeatherLane(settings.proactivity, patch),
  });
  return parseWeatherLane(updated.proactivity);
}

function weatherError(err: unknown): string {
  if (err instanceof WeatherTimeoutError)
    return "The weather service didn't respond in time — try again shortly.";
  if (err instanceof WeatherApiError)
    return `The weather service returned an error (${err.status}).`;
  return "I couldn't reach the weather service just now.";
}

function geocodeError(err: unknown): string {
  if (err instanceof GeocoderTimeoutError)
    return "The location search didn't respond in time — try again shortly.";
  if (err instanceof GeocoderApiError)
    return `The location search returned an error (${err.status}).`;
  return "I couldn't reach the location search service just now.";
}
