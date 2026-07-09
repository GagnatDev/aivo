import { describe, expect, it } from "vitest";
import { YoutubeAccountRepository } from "./youtubeAccountRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

describe("YoutubeAccountRepository", () => {
  it("find reads without provisioning: undefined until first getOrCreate", async () => {
    const repo = new YoutubeAccountRepository(testDb());
    expect(await repo.find()).toBeUndefined();
    await repo.getOrCreate();
    expect((await repo.find())?.id).toBe(1);
  });

  it("getOrCreate provisions the singleton and is idempotent", async () => {
    const repo = new YoutubeAccountRepository(testDb());
    const first = await repo.getOrCreate();
    expect(first.id).toBe(1);
    expect(first.subscriptions_synced_at).toBeNull();
    const second = await repo.getOrCreate();
    expect(second.id).toBe(1);
  });

  it("advances the sync watermarks independently", async () => {
    const repo = new YoutubeAccountRepository(testDb());
    const subsAt = new Date("2026-07-01T06:00:00Z");
    const pollAt = new Date("2026-07-01T07:00:00Z");
    await repo.markSubscriptionsSynced(subsAt);
    await repo.markVideosPolled(pollAt);
    const row = await repo.getOrCreate();
    expect(row.subscriptions_synced_at?.toISOString()).toBe(subsAt.toISOString());
    expect(row.videos_polled_at?.toISOString()).toBe(pollAt.toISOString());
  });
});
