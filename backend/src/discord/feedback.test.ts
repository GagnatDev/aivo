import { describe, expect, it } from "vitest";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import { resolveFeedbackClick } from "./feedback.js";

useCleanDb();

async function setupItem() {
  const deps = makeAgentDeps();
  const { userId } = await provisionUser(deps, OWNER_ID);
  await deps.youtubeChannels.syncSubscriptions(
    [{ id: "UC1", title: "Wood", thumbnailUrl: null }],
    new Date(),
  );
  await deps.videos.upsertDiscovered([
    {
      id: "v1",
      channelId: "UC1",
      title: "Dovetails",
      description: "",
      durationSeconds: null,
      publishedAt: new Date(),
      scheduledStartTime: null,
      thumbnailUrl: null,
    },
  ]);
  const digest = await deps.digests.create({
    userId,
    runDate: "2026-07-01",
    coversSince: new Date(),
  });
  const [item] = await deps.digestItems.insertMany(digest.id, [
    { videoId: "v1", kind: "pick", rank: 1 },
  ]);
  return { deps, userId, itemId: item.id };
}

describe("resolveFeedbackClick", () => {
  it("records a keep click against the digest item and acks", async () => {
    const { deps, userId, itemId } = await setupItem();
    const result = await resolveFeedbackClick(deps, {
      customId: `fb:keep:${itemId}`,
      clickerDiscordId: OWNER_ID,
      clickerDisplayName: "Ann",
    });
    expect(result?.ack).toMatch(/mer av dette/i);
    const rows = await deps.feedback.listUnapplied(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signal: "keep", digest_item_id: itemId });
  });

  it("ignores non-feedback customIds (approval buttons keep working)", async () => {
    const { deps } = await setupItem();
    expect(
      await resolveFeedbackClick(deps, {
        customId: "approve:some-approval",
        clickerDiscordId: OWNER_ID,
        clickerDisplayName: null,
      }),
    ).toBeNull();
    expect(
      await resolveFeedbackClick(deps, {
        customId: "fb:invented_signal:item",
        clickerDiscordId: OWNER_ID,
        clickerDisplayName: null,
      }),
    ).toBeNull();
  });

  it("acks gracefully when the item is gone", async () => {
    const { deps } = await setupItem();
    const result = await resolveFeedbackClick(deps, {
      customId: "fb:drop:00000000-0000-0000-0000-000000000000",
      clickerDiscordId: OWNER_ID,
      clickerDisplayName: null,
    });
    expect(result?.ack).toMatch(/borte/);
  });
});
