import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/profiles/:kind", () => {
  it("returns the current profile and full version history, newest first (ME-6, ME-7)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.profiles.setCurrent(owner.id, "youtube_interest", "Likes space videos.");
    await deps.profiles.setCurrent(owner.id, "youtube_interest", "Likes space and biology.");

    const res = await request(app).get("/api/dashboard/profiles/youtube_interest");
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("youtube_interest");
    expect(res.body.current).toMatchObject({
      version: 2,
      body: "Likes space and biology.",
      isCurrent: true,
    });
    expect(res.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.versions[1].body).toBe("Likes space videos.");
    expect(res.body.versions[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null current and empty history when no profile was ever written", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/profiles/youtube_interest");
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.versions).toEqual([]);
  });

  it("never returns another user's profile and 400s an unknown kind", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await deps.profiles.setCurrent(other.id, "youtube_interest", "their tastes");

    const res = await request(app).get("/api/dashboard/profiles/youtube_interest");
    expect(res.body.current).toBeNull();
    expect((await request(app).get("/api/dashboard/profiles/secrets")).status).toBe(400);
  });
});
