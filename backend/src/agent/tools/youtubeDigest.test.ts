import { describe, expect, it } from "vitest";
import { parseDigestLane } from "../../digest/proactivity.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { useCleanDb } from "../../test/db.js";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";

useCleanDb();

const NOW = new Date("2026-07-01T10:00:00Z");

const tool = (): AgentTool => {
  const t = buildToolRegistry().find((x) => x.schema.name === "youtube_digest");
  if (!t) throw new Error("youtube_digest tool missing");
  return t;
};

async function ctxFor(discordId: string): Promise<ToolContext> {
  const deps = makeAgentDeps(undefined, {}, new FakeClock(NOW));
  const { userId, isOwner, conversationId } = await provisionUser(deps, discordId);
  return { deps, userId, isOwner, conversationId };
}

async function lane(ctx: ToolContext) {
  return parseDigestLane((await ctx.deps.settings.getOrCreate(ctx.userId)).proactivity);
}

describe("youtube_digest tool", () => {
  it("status reports schedule, pause state, and profile", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = JSON.parse(await tool().execute({ action: "status" }, ctx));
    expect(res).toMatchObject({
      enabled: true,
      paused_until: null,
      delivery_hour_local: 7,
      interval_days: 1,
      picks_cap: 8,
      last_run: null,
      interest_profile: "not set up yet",
    });
  });

  it("configure changes hour, interval, and cap (make it weekly at 9)", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool().execute(
      { action: "configure", digest_hour: 9, digest_interval_days: 7, digest_cap: 5 },
      ctx,
    );
    expect(res).toMatch(/every 7 days at 9:00/);
    const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
    expect(settings.digest_hour).toBe(9);
    expect(settings.digest_interval_days).toBe(7);
    expect(settings.digest_cap).toBe(5);
  });

  it("pause for N days sets paused_until and resume clears it", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool().execute({ action: "pause", pause_days: 7 }, ctx);
    expect(res).toMatch(/until 2026-07-08/);
    expect((await lane(ctx)).pausedUntil?.toISOString()).toBe("2026-07-08T10:00:00.000Z");

    await tool().execute({ action: "resume" }, ctx);
    const resumed = await lane(ctx);
    expect(resumed.pausedUntil).toBeNull();
    expect(resumed.enabled).toBe(true);
  });

  it("pause without arguments turns the digest off until resumed", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool().execute({ action: "pause" }, ctx);
    expect(res).toMatch(/turned off/i);
    expect((await lane(ctx)).enabled).toBe(false);
  });

  it("pause_until accepts a date and rejects the past", async () => {
    const ctx = await ctxFor(OWNER_ID);
    expect(await tool().execute({ action: "pause", pause_until: "2026-07-15" }, ctx)).toMatch(
      /until 2026-07-15/,
    );
    expect(await tool().execute({ action: "pause", pause_until: "2020-01-01" }, ctx)).toMatch(
      /in the past/,
    );
  });

  it("run_now arms the request flag the scheduler consumes", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool().execute({ action: "run_now" }, ctx);
    expect(res).toMatch(/within a minute/);
    expect((await lane(ctx)).runRequestedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("set_interests writes a versioned profile", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await tool().execute({ action: "set_interests", interests: "woodworking, no shorts" }, ctx);
    const profile = await ctx.deps.profiles.getCurrent(ctx.userId, "youtube_interest");
    expect(profile?.body).toBe("woodworking, no shorts");
  });

  it("record_feedback stores an unapplied freeform row", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await tool().execute({ action: "record_feedback", feedback: "less news please" }, ctx);
    const rows = await ctx.deps.feedback.listUnapplied(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].freeform_text).toBe("less news please");
  });

  it("mutes and unmutes a channel by title", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await ctx.deps.youtubeChannels.syncSubscriptions(
      [{ id: "UC1", title: "Noisy Channel", thumbnailUrl: null }],
      NOW,
    );
    expect(
      await tool().execute({ action: "mute_channel", channel_title: "noisy channel" }, ctx),
    ).toMatch(/Muted "Noisy Channel"/);
    expect(await ctx.deps.youtubeChannels.listActive()).toHaveLength(0);
    await tool().execute({ action: "unmute_channel", channel_title: "Noisy Channel" }, ctx);
    expect(await ctx.deps.youtubeChannels.listActive()).toHaveLength(1);
  });

  it("refuses mutating actions from a non-owner but allows status and feedback", async () => {
    const ctx = await ctxFor("member-1");
    for (const action of ["configure", "pause", "resume", "run_now", "set_interests"]) {
      expect(await tool().execute({ action, digest_hour: 9 }, ctx)).toMatch(/Refused/);
    }
    expect(await tool().execute({ action: "status" }, ctx)).toMatch(/enabled/);
    expect(await tool().execute({ action: "record_feedback", feedback: "ok" }, ctx)).toMatch(
      /recorded/,
    );
  });

  it("show_more_picks lists only overflow picks from the latest digest", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await ctx.deps.settings.update(ctx.userId, { digest_cap: 1 });
    await ctx.deps.youtubeChannels.syncSubscriptions(
      [{ id: "UC1", title: "Wood", thumbnailUrl: null }],
      NOW,
    );
    await ctx.deps.videos.upsertDiscovered(
      ["v1", "v2"].map((id) => ({
        id,
        channelId: "UC1",
        title: `Video ${id}`,
        description: "",
        durationSeconds: null,
        publishedAt: NOW,
        thumbnailUrl: null,
      })),
    );
    const digest = await ctx.deps.digests.create({
      userId: ctx.userId,
      runDate: "2026-07-01",
      coversSince: NOW,
    });
    await ctx.deps.digestItems.insertMany(digest.id, [
      { videoId: "v1", kind: "pick", rank: 1 },
      { videoId: "v2", kind: "pick", rank: 2 },
    ]);
    const res = await tool().execute({ action: "show_more_picks" }, ctx);
    expect(res).toMatch(/Video v2/);
    expect(res).not.toMatch(/Video v1/);
  });
});
