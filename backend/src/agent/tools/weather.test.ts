import { describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { systemClock } from "../clock.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { useCleanDb } from "../../test/db.js";
import { makeFakeLlm } from "../../test/fakeLlm.js";
import { fakeForecast, makeFakeGeocoder, makeFakeWeather } from "../../test/fakeWeather.js";
import { WeatherTimeoutError, type WeatherClient } from "../../weather/client.js";
import type { Geocoder } from "../../weather/geocoder.js";
import { parseWeatherLane } from "../../weather/proactivity.js";

useCleanDb();

const registry = buildToolRegistry();
const tool = (): AgentTool => {
  const t = registry.find((x) => x.schema.name === "weather");
  if (!t) throw new Error("no weather tool");
  return t;
};

const TRONDHEIM = { name: "Trondheim, Norway", latitude: 63.4305, longitude: 10.3951 };

async function ctxFor(
  discordId: string,
  weather: WeatherClient | null = makeFakeWeather(),
  geocoder: Geocoder | null = makeFakeGeocoder({ trondheim: TRONDHEIM }),
): Promise<ToolContext> {
  const deps = makeAgentDeps(makeFakeLlm([]), {}, systemClock, null, weather, geocoder);
  const { userId, isOwner, conversationId } = await provisionUser(deps, discordId);
  return { deps, userId, isOwner, conversationId };
}

describe("weather tool — forecasts", () => {
  it("forecasts a free-form place by geocoding it", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const out = await tool().execute({ action: "forecast", location: "Trondheim" }, ctx);
    expect(out).toContain("Forecast for Trondheim, Norway");
    expect((ctx.deps.weather as ReturnType<typeof makeFakeWeather>).lastCall).toEqual({
      latitude: 63.4305,
      longitude: 10.3951,
    });
  });

  it("prefers a saved location's coordinates over geocoding", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await ctx.deps.weatherLocations.upsert(ctx.userId, {
      name: "Cabin",
      latitude: 61.1,
      longitude: 9.5,
    });
    const out = await tool().execute({ action: "forecast", location: "cabin" }, ctx);
    expect(out).toContain("Forecast for Cabin");
    expect((ctx.deps.weather as ReturnType<typeof makeFakeWeather>).lastCall).toEqual({
      latitude: 61.1,
      longitude: 9.5,
    });
  });

  it("forecasts explicit coordinates", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const out = await tool().execute(
      { action: "forecast", latitude: 60, longitude: 5, location: "Bergen-ish" },
      ctx,
    );
    expect(out).toContain("Forecast for Bergen-ish");
  });

  it("reports when a place can't be found", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const out = await tool().execute({ action: "forecast", location: "Atlantis" }, ctx);
    expect(out).toContain("couldn't find");
  });

  it("reports weather-service errors without confabulating", async () => {
    const ctx = await ctxFor(
      OWNER_ID,
      makeFakeWeather(fakeForecast(), new WeatherTimeoutError(10)),
    );
    const out = await tool().execute({ action: "forecast", latitude: 60, longitude: 5 }, ctx);
    expect(out).toContain("didn't respond in time");
  });

  it("says so when weather isn't configured", async () => {
    const ctx = await ctxFor(OWNER_ID, null, null);
    expect(await tool().execute({ action: "forecast", location: "x" }, ctx)).toContain(
      "aren't configured",
    );
  });
});

describe("weather tool — locations", () => {
  it("adds a location by geocoding, lists it, and removes it", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const added = await tool().execute(
      { action: "add_location", name: "Home", query: "Trondheim" },
      ctx,
    );
    expect(added).toContain('Saved "Home"');

    const listed = await tool().execute({ action: "list_locations" }, ctx);
    expect(listed).toContain("Home");

    expect(await tool().execute({ action: "remove_location", name: "Home" }, ctx)).toContain(
      "Removed",
    );
    expect(await tool().execute({ action: "list_locations" }, ctx)).toContain("no saved");
  });
});

describe("weather tool — morning report (owner-only)", () => {
  it("sets home, configures, and requests a run", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await tool().execute({ action: "add_location", name: "Home", query: "Trondheim" }, ctx);

    expect(await tool().execute({ action: "set_home", name: "Home" }, ctx)).toContain("Home set");
    const cfg = await tool().execute(
      { action: "configure_report", enabled: true, report_hour: 6 },
      ctx,
    );
    expect(cfg).toContain("on at 6:00");

    const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
    expect(parseWeatherLane(settings.proactivity)).toMatchObject({ enabled: true, reportHour: 6 });

    const run = await tool().execute({ action: "run_report_now" }, ctx);
    expect(run).toContain("requested");
    const after = await ctx.deps.settings.getOrCreate(ctx.userId);
    expect(parseWeatherLane(after.proactivity).runRequestedAt).not.toBeNull();
  });

  it("nudges to set a home when enabling with none", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const cfg = await tool().execute({ action: "configure_report", enabled: true }, ctx);
    expect(cfg).toContain("No home location is set");
  });

  it("run_report_now refuses without a home", async () => {
    const ctx = await ctxFor(OWNER_ID);
    expect(await tool().execute({ action: "run_report_now" }, ctx)).toContain(
      "Set a home location",
    );
  });

  it("refuses owner-only actions for non-owners", async () => {
    const ctx = await ctxFor("member-1");
    expect(ctx.isOwner).toBe(false);
    for (const action of ["set_home", "configure_report", "run_report_now"]) {
      const out = await tool().execute({ action, name: "x", enabled: true }, ctx);
      expect(out).toBe("Refused: only the owner can do that.");
    }
  });

  it("report_status is readable by anyone and reflects config", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const status = JSON.parse(await tool().execute({ action: "report_status" }, ctx));
    expect(status).toMatchObject({ enabled: false, delivery_hour_local: 6, home_location: null });
  });
});
