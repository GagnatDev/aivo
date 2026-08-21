import { describe, expect, it } from "vitest";
import { VideoRepository, type DiscoveredVideoInput } from "./videoRepository.js";
import { YoutubeChannelRepository } from "./youtubeChannelRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

const NOW = new Date("2026-07-01T07:00:00Z");

function video(
  id: string,
  channelId: string,
  publishedAt: Date,
  scheduledStartTime: Date | null = null,
): DiscoveredVideoInput {
  return {
    id,
    channelId,
    title: `Video ${id}`,
    description: "desc",
    durationSeconds: 600,
    publishedAt,
    scheduledStartTime,
    thumbnailUrl: null,
  };
}

async function setup() {
  const db = testDb();
  const channels = new YoutubeChannelRepository(db);
  const videos = new VideoRepository(db);
  await channels.syncSubscriptions(
    [
      { id: "UC1", title: "Alpha", thumbnailUrl: null },
      { id: "UC2", title: "Beta", thumbnailUrl: null },
    ],
    NOW,
  );
  return { channels, videos };
}

describe("VideoRepository", () => {
  it("upsertDiscovered is idempotent and keeps existing filter results", async () => {
    const { videos } = await setup();
    await videos.upsertDiscovered([video("v1", "UC1", NOW)]);
    await videos.saveStage1Scores([{ id: "v1", score: 0.9 }], NOW);
    await videos.upsertDiscovered([video("v1", "UC1", NOW)]);
    const [row] = await videos.findByIds(["v1"]);
    expect(row.stage1_score).toBeCloseTo(0.9);
  });

  it("listCandidatesSince filters by window, subscription, and mute", async () => {
    const { channels, videos } = await setup();
    const old = new Date("2026-06-29T07:00:00Z");
    const fresh = new Date("2026-06-30T20:00:00Z");
    await videos.upsertDiscovered([
      video("v-old", "UC1", old),
      video("v-new", "UC1", fresh),
      video("v-muted", "UC2", fresh),
    ]);
    await channels.setMuted("UC2", true);
    const since = new Date("2026-06-30T07:00:00Z");
    const candidates = await videos.listCandidatesSince(since, 50);
    expect(candidates.map((v) => v.id)).toEqual(["v-new"]);
  });

  it("saveStage2 records verdict, summary, and transcript status", async () => {
    const { videos } = await setup();
    await videos.upsertDiscovered([video("v1", "UC1", NOW)]);
    await videos.saveStage2("v1", {
      transcriptStatus: "fetched",
      decision: "pick",
      summary: "- point one\n- point two",
      why: "matches your woodworking interest",
    });
    const [row] = await videos.findByIds(["v1"]);
    expect(row.stage2_decision).toBe("pick");
    expect(row.transcript_status).toBe("fetched");
    expect(row.summary).toMatch(/point one/);
  });

  it("channelTitles maps ids to titles", async () => {
    const { videos } = await setup();
    const titles = await videos.channelTitles(["UC1", "UC2"]);
    expect(titles.get("UC1")).toBe("Alpha");
    expect(titles.get("UC2")).toBe("Beta");
  });
});
