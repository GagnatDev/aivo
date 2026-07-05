import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/memories", () => {
  it("lists active memories in injection order: pinned first, then newest", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.memories.insert({ userId: owner.id, content: "oldest", category: "fact" });
    await deps.memories.insert({
      userId: owner.id,
      content: "pinned oldie",
      category: "preference",
      pinned: true,
    });
    await deps.memories.insert({ userId: owner.id, content: "newest", category: "context" });

    const res = await request(app).get("/api/dashboard/memories");
    expect(res.status).toBe(200);
    // listActive is newest-first; the stable pin sort lifts pinned rows to the top.
    expect(res.body.memories.map((m: { content: string }) => m.content)).toEqual([
      "pinned oldie",
      "newest",
      "oldest",
    ]);
    const pinned = res.body.memories[0];
    expect(pinned.pinned).toBe(true);
    expect(pinned.category).toBe("preference");
    expect(pinned.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("excludes forgotten memories and reports the injection hint (ME-5)", async () => {
    const { app, deps } = buildDashboardTestApp({ memoryInjectLimit: 2 });
    const owner = await provisionTestOwner(deps);
    await deps.memories.insert({ userId: owner.id, content: "keep one" });
    await deps.memories.insert({ userId: owner.id, content: "keep two" });
    await deps.memories.insert({ userId: owner.id, content: "keep three" });
    const gone = await deps.memories.insert({ userId: owner.id, content: "gone" });
    await deps.memories.forget(gone.id, owner.id);

    const res = await request(app).get("/api/dashboard/memories");
    expect(res.body.memories).toHaveLength(3);
    expect(res.body.activeCount).toBe(3);
    // 3 active but only 2 fit the context window: injected = min(active, limit).
    expect(res.body.injectedCount).toBe(2);
    expect(res.body.injectLimit).toBe(2);
  });

  it("searches with the agent tool's ILIKE semantics, wildcards escaped", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.memories.insert({ userId: owner.id, content: "drinks 100% arabica coffee" });
    await deps.memories.insert({ userId: owner.id, content: "100 push-ups a day" });

    const res = await request(app).get("/api/dashboard/memories?q=100%25");
    expect(res.body.memories.map((m: { content: string }) => m.content)).toEqual([
      "drinks 100% arabica coffee",
    ]);
    expect(res.body.query).toBe("100%");
    // Count KPIs stay over the full active set while a search narrows the list.
    expect(res.body.activeCount).toBe(2);
  });

  it("filters by category and keeps counts over the whole active set", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.memories.insert({ userId: owner.id, content: "vegetarian", category: "preference" });
    await deps.memories.insert({ userId: owner.id, content: "lives in Oslo", category: "fact" });
    await deps.memories.insert({ userId: owner.id, content: "kayak trip soon" });

    const res = await request(app).get("/api/dashboard/memories?category=fact");
    expect(res.body.memories.map((m: { content: string }) => m.content)).toEqual(["lives in Oslo"]);
    expect(res.body.category).toBe("fact");
    expect(res.body.categoryCounts).toEqual({ preference: 1, fact: 1, uncategorized: 1 });
  });

  it("never leaks another user's memories", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await deps.memories.insert({ userId: other.id, content: "their secret" });

    const res = await request(app).get("/api/dashboard/memories");
    expect(res.body.memories).toEqual([]);
    expect(res.body.activeCount).toBe(0);
  });

  it("serves the forgotten audit trail separately (ME-8)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.memories.insert({ userId: owner.id, content: "still active" });
    const gone = await deps.memories.insert({ userId: owner.id, content: "old address" });
    await deps.memories.forget(gone.id, owner.id);

    const res = await request(app).get("/api/dashboard/memories/forgotten");
    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
    expect(res.body.memories[0]).toMatchObject({ content: "old address" });
    expect(res.body.memories[0].forgottenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("400s a bogus category or an oversized query", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const badCategory = await request(app).get("/api/dashboard/memories?category=secrets");
    expect(badCategory.status).toBe(400);
    const longQuery = await request(app).get(`/api/dashboard/memories?q=${"a".repeat(201)}`);
    expect(longQuery.status).toBe(400);
  });
});
