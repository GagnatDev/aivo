import { describe, expect, it } from "vitest";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { fakeForecast, makeFakeWeather } from "../test/fakeWeather.js";
import { WeatherApiError } from "./client.js";
import { runWeatherReport } from "./report.js";

useCleanDb();

const NOW = new Date("2026-07-23T04:00:00Z"); // 06:00 Europe/Oslo

describe("runWeatherReport", () => {
  it("returns no_home when the user has no home location", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]), {}, undefined, null, makeFakeWeather());
    const { userId } = await provisionUser(deps, OWNER_ID);
    const weather = deps.weather;
    if (!weather) throw new Error("weather not wired");
    expect(await runWeatherReport(deps, weather, userId, NOW)).toEqual({ kind: "no_home" });
  });

  it("fetches the home forecast and renders report text", async () => {
    const weather = makeFakeWeather(fakeForecast());
    const deps = makeAgentDeps(makeFakeLlm([]), {}, undefined, null, weather);
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.setHome(userId, "Oslo");

    const outcome = await runWeatherReport(deps, weather, userId, NOW);
    expect(outcome.kind).toBe("report");
    if (outcome.kind === "report") {
      expect(outcome.locationName).toBe("Oslo");
      expect(outcome.text).toContain("God morgen! Vær for Oslo");
    }
    expect(weather.lastCall).toEqual({ latitude: 59.9, longitude: 10.7 });
  });

  it("turns an upstream failure into an error outcome, never throwing", async () => {
    const weather = makeFakeWeather(fakeForecast(), new WeatherApiError(503, "down"));
    const deps = makeAgentDeps(makeFakeLlm([]), {}, undefined, null, weather);
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.setHome(userId, "Oslo");

    const outcome = await runWeatherReport(deps, weather, userId, NOW);
    expect(outcome).toMatchObject({ kind: "error" });
  });
});
