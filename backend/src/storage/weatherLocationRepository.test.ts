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

  it("shared locations are visible to every user; private ones are not", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");

    await deps.weatherLocations.upsert(owner, {
      name: "Cabin",
      latitude: 61.1,
      longitude: 9.5,
      shared: true,
    });
    await deps.weatherLocations.upsert(owner, { name: "Work", latitude: 59.9, longitude: 10.7 });

    // The member sees the shared cabin (created by the owner) but not the owner's private work.
    expect((await deps.weatherLocations.findByName(member, "cabin"))?.name).toBe("Cabin");
    expect(await deps.weatherLocations.findByName(member, "work")).toBeUndefined();
    expect((await deps.weatherLocations.list(member)).map((l) => l.name)).toEqual(["Cabin"]);
  });

  it("a private location shadows a shared one of the same name for that user", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");

    // A shared "Work" plus the member's own private "Work".
    await deps.weatherLocations.upsert(owner, {
      name: "Work",
      latitude: 59.9,
      longitude: 10.7,
      shared: true,
    });
    await deps.weatherLocations.upsert(member, { name: "Work", latitude: 63.4, longitude: 10.4 });

    // The member resolves their own; the owner (no private "Work") gets the shared one.
    const forMember = await deps.weatherLocations.findByName(member, "work");
    expect(forMember).toMatchObject({ user_id: member, is_shared: false, latitude: 63.4 });
    const forOwner = await deps.weatherLocations.findByName(owner, "work");
    expect(forOwner).toMatchObject({ is_shared: true, latitude: 59.9 });
  });

  it("upsert keeps private and shared same-name locations separate", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);

    await deps.weatherLocations.upsert(userId, { name: "Home", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.upsert(userId, {
      name: "Home",
      latitude: 63.4,
      longitude: 10.4,
      shared: true,
    });

    const all = await deps.weatherLocations.list(userId);
    expect(all.filter((l) => l.name === "Home")).toHaveLength(2);
    // Private (own) shadows shared on lookup.
    expect(await deps.weatherLocations.findByName(userId, "home")).toMatchObject({
      is_shared: false,
    });
  });

  it("a shared location can be removed by any family member", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");
    await deps.weatherLocations.upsert(owner, {
      name: "Cabin",
      latitude: 61.1,
      longitude: 9.5,
      shared: true,
    });

    expect(await deps.weatherLocations.remove(member, "Cabin")).toMatchObject({ is_shared: true });
    expect(await deps.weatherLocations.findByName(owner, "Cabin")).toBeUndefined();
  });

  it("setHome can point the report at a shared location", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(owner, {
      name: "Home",
      latitude: 59.9,
      longitude: 10.7,
      shared: true,
    });

    expect(await deps.weatherLocations.setHome(owner, "Home")).toMatchObject({
      is_home: true,
      is_shared: true,
    });
    expect((await deps.weatherLocations.getHome(owner))?.name).toBe("Home");
  });
});
