import request from "supertest";
import { describe, expect, it } from "vitest";
import { YoutubeChannelRepository } from "../../storage/youtubeChannelRepository.js";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { testDb, useCleanDb } from "../../test/db.js";
import type { DashboardDeps } from "./index.js";

useCleanDb();

/** One delivered run with two ranked picks and a reject, like the pipeline writes. */
async function seedDeliveredRun(deps: DashboardDeps, userId: string) {
  await new YoutubeChannelRepository(testDb()).syncSubscriptions(
    [{ id: "UC1", title: "Kurzgesagt", thumbnailUrl: null }],
    new Date(),
  );
  await deps.videos.upsertDiscovered(
    ["v1", "v2", "v3"].map((id) => ({
      id,
      channelId: "UC1",
      title: `Video ${id}`,
      description: "",
      durationSeconds: 600,
      publishedAt: new Date("2026-07-01T08:00:00Z"),
      thumbnailUrl: null,
    })),
  );
  const run = await deps.digests.create({
    userId,
    runDate: "2026-07-01",
    coversSince: new Date("2026-06-30T06:00:00Z"),
  });
  await deps.digestItems.insertMany(run.id, [
    { videoId: "v1", kind: "pick", rank: 1, confidence: 0.9, reason: "space content" },
    { videoId: "v2", kind: "pick", rank: 2, confidence: 0.7 },
    { videoId: "v3", kind: "reject", confidence: 0.2, reason: "news recap — you said no" },
  ]);
  await deps.digests.setCostCents(run.id, 3.5);
  await deps.digests.markDelivered(run.id, new Date("2026-07-01T06:01:00Z"));
  return run;
}

describe("GET /api/dashboard/digests", () => {
  it("lists runs newest first with pick/reject counts and cost (D-1, D-3)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const delivered = await seedDeliveredRun(deps, owner.id);
    const pending = await deps.digests.create({
      userId: owner.id,
      runDate: "2026-07-02",
      coversSince: new Date("2026-07-01T06:00:00Z"),
    });

    const res = await request(app).get("/api/dashboard/digests");
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r: { id: string }) => r.id)).toEqual([pending.id, delivered.id]);
    const [newest, older] = res.body.runs;
    expect(newest).toMatchObject({
      runDate: "2026-07-02",
      status: "pending",
      pickCount: 0,
      rejectCount: 0,
      deliveredAt: null,
    });
    expect(older).toMatchObject({
      runDate: "2026-07-01",
      status: "delivered",
      pickCount: 2,
      rejectCount: 1,
    });
    expect(older.cost.cents).toBeCloseTo(3.5);
    expect(older.deliveredAt).toMatch(/^2026-07-01T/);
  });

  it("reports YouTube connection status alongside the runs (D-5)", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);

    const before = await request(app).get("/api/dashboard/digests");
    expect(before.body.youtube).toEqual({
      connected: false,
      title: null,
      subscriptionsSyncedAt: null,
      videosPolledAt: null,
      // No OAuth client configured in this harness → nothing to link at.
      oauthStartPath: null,
      refreshTokenSecretKey: "YOUTUBE_OAUTH_REFRESH_TOKEN",
    });

    await deps.youtubeAccount.setIdentity({
      youtubeChannelId: "UCme",
      title: "Ann-Katrin",
      connectedByUserId: null,
    });
    await deps.youtubeAccount.markSubscriptionsSynced(new Date("2026-07-01T05:00:00Z"));

    const after = await request(app).get("/api/dashboard/digests");
    expect(after.body.youtube).toMatchObject({
      connected: true,
      title: "Ann-Katrin",
      subscriptionsSyncedAt: "2026-07-01T05:00:00.000Z",
    });
  });

  it("reports a failed run's status and reason instead of leaving it pending (#83)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const run = await deps.digests.create({
      userId: owner.id,
      runDate: "2026-07-01",
      coversSince: new Date("2026-06-30T06:00:00Z"),
    });
    await deps.digests.markFailed(run.id, {
      kind: "youtube_auth",
      message: "YouTube OAuth token refresh failed (400 invalid_grant: Token has been revoked.)",
    });

    const list = await request(app).get("/api/dashboard/digests");
    expect(list.body.runs[0]).toMatchObject({
      status: "failed",
      deliveredAt: null,
      failure: {
        kind: "youtube_auth",
        message: "YouTube OAuth token refresh failed (400 invalid_grant: Token has been revoked.)",
      },
    });

    const detail = await request(app).get(`/api/dashboard/digests/${run.id}`);
    expect(detail.body.run.failure.kind).toBe("youtube_auth");
  });

  it("reports no failure on a run that did not fail", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await seedDeliveredRun(deps, owner.id);

    const res = await request(app).get("/api/dashboard/digests");
    expect(res.body.runs[0].failure).toBeNull();
  });

  it("points at the OAuth handshake when the deployment has a client configured (#83)", async () => {
    const { app, deps } = buildDashboardTestApp({ youtubeOauthConfigured: true });
    await provisionTestOwner(deps);

    const res = await request(app).get("/api/dashboard/digests");
    expect(res.body.youtube.oauthStartPath).toBe("/youtube/oauth/start");
  });

  it("never lists another user's runs", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await deps.digests.create({ userId: other.id, runDate: "2026-07-01", coversSince: new Date() });

    const res = await request(app).get("/api/dashboard/digests");
    expect(res.body.runs).toEqual([]);
  });
});

describe("GET /api/dashboard/digests/:id", () => {
  it("returns the run with ranked picks, rejects, and video metadata (D-2)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const run = await seedDeliveredRun(deps, owner.id);

    const res = await request(app).get(`/api/dashboard/digests/${run.id}`);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(run.id);
    expect(res.body.picks.map((p: { rank: number }) => p.rank)).toEqual([1, 2]);
    expect(res.body.picks[0]).toMatchObject({
      confidence: 0.9,
      reason: "space content",
      video: {
        id: "v1",
        title: "Video v1",
        channelTitle: "Kurzgesagt",
        durationSeconds: 600,
      },
    });
    expect(res.body.rejects).toHaveLength(1);
    expect(res.body.rejects[0].reason).toMatch(/news recap/);
    expect(res.body.rejects[0].video.id).toBe("v3");
  });

  it("summarizes the run's feedback reactions (D-4)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const run = await seedDeliveredRun(deps, owner.id);
    const items = await deps.digestItems.listByDigest(run.id);
    await deps.feedback.insert({ userId: owner.id, digestItemId: items[0].id, signal: "keep" });
    await deps.feedback.insert({ userId: owner.id, digestItemId: items[1].id, signal: "keep" });
    await deps.feedback.insert({ userId: owner.id, digestItemId: items[1].id, signal: "too_long" });

    const res = await request(app).get(`/api/dashboard/digests/${run.id}`);
    expect(res.body.feedback).toEqual({
      keep: 2,
      drop: 0,
      tooLong: 1,
      wrongTopic: 0,
      freeform: 0,
    });
  });

  it("404s another user's run and 400s a malformed id", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    const foreign = await deps.digests.create({
      userId: other.id,
      runDate: "2026-07-01",
      coversSince: new Date(),
    });

    expect((await request(app).get(`/api/dashboard/digests/${foreign.id}`)).status).toBe(404);
    expect((await request(app).get("/api/dashboard/digests/not-a-uuid")).status).toBe(400);
  });
});
