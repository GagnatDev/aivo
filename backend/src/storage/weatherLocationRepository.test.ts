import { describe, expect, it } from "vitest";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

describe("WeatherLocationRepository", () => {
  it("upserts by case-insensitive name and lists home-first then alphabetical", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);

    await deps.weatherLocations.upsert(userId, {
      name: "Oslo",
      latitude: 59.9139,
      longitude: 10.7522,
      displayName: "Oslo, Norway",
    });
    await deps.weatherLocations.upsert(userId, {
      name: "Bergen",
      latitude: 60.39,
      longitude: 5.32,
    });
    // Re-saving under a different case refreshes coordinates rather than inserting a copy.
    const refreshed = await deps.weatherLocations.upsert(userId, {
      name: "oslo",
      latitude: 59.91,
      longitude: 10.75,
    });

    const all = await deps.weatherLocations.list(userId);
    expect(all.map((l) => l.name)).toEqual(["Bergen", "Oslo"]);
    expect(refreshed.latitude).toBeCloseTo(59.91);
    expect((await deps.weatherLocations.findByName(userId, "OSLO"))?.longitude).toBeCloseTo(10.75);
  });

  it("setHome moves the flag atomically so only one home exists", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.upsert(userId, { name: "Tromsø", latitude: 69.6, longitude: 18.9 });

    expect(await deps.weatherLocations.setHome(userId, "Oslo")).toMatchObject({ is_home: true });
    expect((await deps.weatherLocations.getHome(userId))?.name).toBe("Oslo");

    await deps.weatherLocations.setHome(userId, "Tromsø");
    const home = await deps.weatherLocations.getHome(userId);
    expect(home?.name).toBe("Tromsø");
    const homes = (await deps.weatherLocations.list(userId)).filter((l) => l.is_home);
    expect(homes).toHaveLength(1);
  });

  it("setHome on an unknown name returns undefined and changes nothing", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });

    expect(await deps.weatherLocations.setHome(userId, "Paris")).toBeUndefined();
    expect(await deps.weatherLocations.getHome(userId)).toBeUndefined();
  });

  it("remove deletes by name and is scoped per user", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");
    await deps.weatherLocations.upsert(owner, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.upsert(member, { name: "Oslo", latitude: 59.9, longitude: 10.7 });

    // A member can't remove the owner's location — the delete is user-scoped.
    expect(await deps.weatherLocations.remove(member, "Oslo")).toMatchObject({ user_id: member });
    expect(await deps.weatherLocations.findByName(owner, "Oslo")).toBeDefined();
    expect(await deps.weatherLocations.remove(owner, "Oslo")).toMatchObject({ user_id: owner });
    expect(await deps.weatherLocations.remove(owner, "Oslo")).toBeUndefined();
  });
});
