import request from "supertest";
import { describe, expect, it } from "vitest";
import { VideoRepository } from "../../storage/videoRepository.js";
import { YoutubeChannelRepository } from "../../storage/youtubeChannelRepository.js";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { testDb, useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/overview", () => {
  it("bundles spend, memory, digest, and health KPIs", async () => {
    const { app, deps } = buildDashboardTestApp({ gatewayStatus: () => true });
    const owner = await provisionTestOwner(deps);

    await deps.llmUsage.insert({
      userId: owner.id,
      taskType: "chat",
      model: "test-model",
      tokensIn: 100,
      tokensOut: 50,
      costCents: 2.5,
    });
    await deps.memories.insert({ userId: owner.id, content: "likes coffee" });

    const db = testDb();
    await new YoutubeChannelRepository(db).syncSubscriptions(
      [{ id: "UC1", title: "Alpha", thumbnailUrl: null }],
      new Date(),
    );
    await new VideoRepository(db).upsertDiscovered([
      {
        id: "v1",
        channelId: "UC1",
        title: "v1",
        description: "",
        durationSeconds: null,
        publishedAt: new Date(),
        thumbnailUrl: null,
      },
    ]);
    const digest = await deps.digests.create({
      userId: owner.id,
      runDate: "2026-07-01",
      coversSince: new Date("2026-06-30T00:00:00Z"),
    });
    await deps.digestItems.insertMany(digest.id, [
      { videoId: "v1", kind: "pick", rank: 1, confidence: 0.9 },
    ]);
    await deps.digests.setCostCents(digest.id, 1.25);
    await deps.digests.markDelivered(digest.id, new Date("2026-07-01T17:00:00Z"));

    const res = await request(app).get("/api/dashboard/overview");
    expect(res.status).toBe(200);

    expect(res.body.spend.today).toEqual({ cents: 2.5, formatted: "2.5¢" });
    expect(res.body.spend.monthToDate.cents).toBe(2.5);
    // budget_config defaults: 1500¢ ceiling.
    expect(res.body.spend.monthlyCeiling).toEqual({ cents: 1500, formatted: "€15.00" });
    expect(res.body.spend.degradation.state).toBe("normal");

    expect(res.body.memory.activeCount).toBe(1);
    expect(res.body.memory.lastWriteAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(res.body.digest).toEqual({
      runDate: "2026-07-01",
      status: "delivered",
      cost: { cents: 1.25, formatted: "1.25¢" },
      deliveredAt: "2026-07-01T17:00:00.000Z",
      pickCount: 1,
      failure: null,
    });

    expect(res.body.health).toEqual({ db: "ok", gateway: "connected" });
  });

  it("handles the fresh install: no usage, no memories, no digest, no gateway probe", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);

    const res = await request(app).get("/api/dashboard/overview");
    expect(res.status).toBe(200);
    expect(res.body.spend.today.cents).toBe(0);
    expect(res.body.memory).toEqual({ activeCount: 0, lastWriteAt: null });
    expect(res.body.digest).toBeNull();
    expect(res.body.health.gateway).toBe("unknown");
  });

  it("reports a disconnected gateway", async () => {
    const { app, deps } = buildDashboardTestApp({ gatewayStatus: () => false });
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/overview");
    expect(res.body.health.gateway).toBe("disconnected");
  });

  it("explains a failed last run rather than calling it pending (#83)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const run = await deps.digests.create({
      userId: owner.id,
      runDate: "2026-07-01",
      coversSince: new Date("2026-06-30T00:00:00Z"),
    });
    await deps.digests.markFailed(run.id, {
      kind: "youtube_auth",
      message: "YouTube OAuth token refresh failed (400 invalid_grant)",
    });

    const res = await request(app).get("/api/dashboard/overview");
    expect(res.body.digest).toMatchObject({
      status: "failed",
      deliveredAt: null,
      failure: {
        kind: "youtube_auth",
        message: "YouTube OAuth token refresh failed (400 invalid_grant)",
      },
    });
  });

  it("never leaks another user's KPIs", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await deps.memories.insert({ userId: other.id, content: "their memory" });
    await deps.llmUsage.insert({
      userId: other.id,
      taskType: "chat",
      model: "test-model",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 50,
    });

    const res = await request(app).get("/api/dashboard/overview");
    expect(res.body.spend.monthToDate.cents).toBe(0);
    expect(res.body.memory.activeCount).toBe(0);
  });
});
