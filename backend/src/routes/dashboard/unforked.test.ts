import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";
import { makeFakeUnforked } from "../../test/fakeUnforked.js";

useCleanDb();

const VALID_KEY = "ufk_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";

describe("GET /api/dashboard/unforked", () => {
  it("reports not configured / not connected on a bare deployment", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/unforked");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: false,
      connected: false,
      ownerEmail: null,
      keyName: null,
      verifiedAt: null,
    });
  });

  it("never echoes the stored key", async () => {
    const { app, deps } = buildDashboardTestApp({ unforked: makeFakeUnforked() });
    const owner = await provisionTestOwner(deps);
    await deps.unforkedConnection.connect({
      apiKey: VALID_KEY,
      ownerEmail: "ann@example.com",
      keyName: "Aivo",
      connectedByUserId: owner.id,
    });
    const res = await request(app).get("/api/dashboard/unforked");
    expect(res.body.connected).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(VALID_KEY);
  });
});

describe("PUT /api/dashboard/unforked", () => {
  it("verifies the key against unforked, then stores it with the echoed metadata", async () => {
    const fake = makeFakeUnforked();
    const { app, deps } = buildDashboardTestApp({ unforked: fake });
    const owner = await provisionTestOwner(deps);

    const res = await request(app).put("/api/dashboard/unforked").send({ apiKey: VALID_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      connected: true,
      ownerEmail: "ann.katrin@example.com",
      keyName: "Aivo",
    });
    expect(fake.calls).toEqual([{ method: "verifyKey", arg: VALID_KEY }]);

    const stored = await deps.unforkedConnection.find();
    expect(stored?.api_key).toBe(VALID_KEY);
    expect(stored?.connected_by_user_id).toBe(owner.id);
  });

  it("rejects a key unforked 401s without storing anything", async () => {
    const { app, deps } = buildDashboardTestApp({
      unforked: makeFakeUnforked({ failStatus: 401 }),
    });
    await provisionTestOwner(deps);
    const res = await request(app).put("/api/dashboard/unforked").send({ apiKey: VALID_KEY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("key rejected");
    expect(await deps.unforkedConnection.find()).toBeUndefined();
  });

  it("502s (and stores nothing) when unforked is unreachable", async () => {
    const { app, deps } = buildDashboardTestApp({
      unforked: makeFakeUnforked({ unreachable: true }),
    });
    await provisionTestOwner(deps);
    const res = await request(app).put("/api/dashboard/unforked").send({ apiKey: VALID_KEY });
    expect(res.status).toBe(502);
    expect(await deps.unforkedConnection.find()).toBeUndefined();
  });

  it("rejects a value that is not shaped like an unforked key", async () => {
    const fake = makeFakeUnforked();
    const { app, deps } = buildDashboardTestApp({ unforked: fake });
    await provisionTestOwner(deps);
    const res = await request(app).put("/api/dashboard/unforked").send({ apiKey: "hunter2" });
    expect(res.status).toBe(400);
    // Shape check happens before any network call with the value.
    expect(fake.calls).toEqual([]);
  });

  it("409s when UNFORKED_BASE_URL is not configured", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).put("/api/dashboard/unforked").send({ apiKey: VALID_KEY });
    expect(res.status).toBe(409);
  });

  it("replaces a previously registered key", async () => {
    const { app, deps } = buildDashboardTestApp({ unforked: makeFakeUnforked() });
    const owner = await provisionTestOwner(deps);
    await deps.unforkedConnection.connect({
      apiKey: "ufk_old",
      ownerEmail: null,
      keyName: null,
      connectedByUserId: owner.id,
    });
    await request(app).put("/api/dashboard/unforked").send({ apiKey: VALID_KEY }).expect(200);
    expect((await deps.unforkedConnection.find())?.api_key).toBe(VALID_KEY);
  });
});

describe("DELETE /api/dashboard/unforked", () => {
  it("disconnects and forgets the key", async () => {
    const { app, deps } = buildDashboardTestApp({ unforked: makeFakeUnforked() });
    const owner = await provisionTestOwner(deps);
    await deps.unforkedConnection.connect({
      apiKey: VALID_KEY,
      ownerEmail: null,
      keyName: null,
      connectedByUserId: owner.id,
    });
    await request(app).delete("/api/dashboard/unforked").expect(204);
    expect(await deps.unforkedConnection.find()).toBeUndefined();
    const res = await request(app).get("/api/dashboard/unforked");
    expect(res.body.connected).toBe(false);
  });
});
