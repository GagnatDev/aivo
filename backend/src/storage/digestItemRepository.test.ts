import { describe, expect, it } from "vitest";
import { DigestItemRepository } from "./digestItemRepository.js";
import { DigestRepository } from "./digestRepository.js";
import { UserRepository } from "./userRepository.js";
import { VideoRepository } from "./videoRepository.js";
import { YoutubeChannelRepository } from "./youtubeChannelRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  await new YoutubeChannelRepository(db).syncSubscriptions(
    [{ id: "UC1", title: "Alpha", thumbnailUrl: null }],
    new Date(),
  );
  await new VideoRepository(db).upsertDiscovered(
    ["v1", "v2", "v3"].map((id) => ({
      id,
      channelId: "UC1",
      title: id,
      description: "",
      durationSeconds: null,
      publishedAt: new Date(),
      thumbnailUrl: null,
    })),
  );
  const digest = await new DigestRepository(db).create({
    userId: user.id,
    runDate: "2026-07-01",
    coversSince: new Date(),
  });
  return { items: new DigestItemRepository(db), digestId: digest.id };
}

describe("DigestItemRepository", () => {
  it("inserts and lists picks (by rank) before rejects", async () => {
    const { items, digestId } = await setup();
    await items.insertMany(digestId, [
      { videoId: "v3", kind: "reject", reason: "news recap — you said no", confidence: 0.3 },
      { videoId: "v2", kind: "pick", rank: 2, confidence: 0.7 },
      { videoId: "v1", kind: "pick", rank: 1, confidence: 0.9 },
    ]);
    const listed = await items.listByDigest(digestId);
    expect(listed.map((i) => i.video_id)).toEqual(["v1", "v2", "v3"]);
    expect(listed[2].reason).toMatch(/news recap/);
  });

  it("findById returns a single item", async () => {
    const { items, digestId } = await setup();
    const [inserted] = await items.insertMany(digestId, [{ videoId: "v1", kind: "pick", rank: 1 }]);
    expect((await items.findById(inserted.id))?.video_id).toBe("v1");
  });
});
