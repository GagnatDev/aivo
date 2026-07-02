import { describe, expect, it } from "vitest";
import { YoutubeChannelRepository } from "./youtubeChannelRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

const NOW = new Date("2026-07-01T07:00:00Z");
const chan = (id: string, title: string) => ({ id, title, thumbnailUrl: null });

describe("YoutubeChannelRepository", () => {
  it("syncSubscriptions upserts the list and unsubscribes missing channels", async () => {
    const repo = new YoutubeChannelRepository(testDb());
    await repo.syncSubscriptions([chan("UC1", "Alpha"), chan("UC2", "Beta")], NOW);
    expect((await repo.listActive()).map((c) => c.id)).toEqual(["UC1", "UC2"]);

    // UC2 dropped from the list: kept in the cache but no longer active.
    await repo.syncSubscriptions([chan("UC1", "Alpha")], NOW);
    expect((await repo.listActive()).map((c) => c.id)).toEqual(["UC1"]);

    // Re-subscribing revives it.
    await repo.syncSubscriptions([chan("UC1", "Alpha"), chan("UC2", "Beta v2")], NOW);
    const active = await repo.listActive();
    expect(active.map((c) => c.id)).toEqual(["UC1", "UC2"]);
    expect(active.find((c) => c.id === "UC2")?.title).toBe("Beta v2");
  });

  it("muted channels stay muted across syncs and are excluded from listActive", async () => {
    const repo = new YoutubeChannelRepository(testDb());
    await repo.syncSubscriptions([chan("UC1", "Alpha"), chan("UC2", "Beta")], NOW);
    expect(await repo.setMuted("UC2", true)).toMatchObject({ muted: true });
    await repo.syncSubscriptions([chan("UC1", "Alpha"), chan("UC2", "Beta")], NOW);
    expect((await repo.listActive()).map((c) => c.id)).toEqual(["UC1"]);
  });

  it("findByTitle resolves case-insensitively", async () => {
    const repo = new YoutubeChannelRepository(testDb());
    await repo.syncSubscriptions([chan("UC1", "Alpha Workshop")], NOW);
    expect((await repo.findByTitle("alpha workshop"))?.id).toBe("UC1");
    expect(await repo.findByTitle("nope")).toBeUndefined();
  });
});
