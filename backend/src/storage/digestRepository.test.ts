import { describe, expect, it } from "vitest";
import { DigestRepository } from "./digestRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const digests = new DigestRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { digests, userId: user.id };
}

describe("DigestRepository", () => {
  it("creates pending runs and reads run_date back as YYYY-MM-DD", async () => {
    const { digests, userId } = await setup();
    const row = await digests.create({
      userId,
      runDate: "2026-07-01",
      coversSince: new Date("2026-06-30T05:00:00Z"),
    });
    expect(row.status).toBe("pending");
    expect(row.run_date).toBe("2026-07-01");
  });

  it("latestForUser returns the most recent run regardless of status", async () => {
    const { digests, userId } = await setup();
    await digests.create({ userId, runDate: "2026-06-30", coversSince: new Date() });
    const second = await digests.create({ userId, runDate: "2026-07-01", coversSince: new Date() });
    expect((await digests.latestForUser(userId))?.id).toBe(second.id);
  });

  it("listForUser returns runs newest first, scoped by user", async () => {
    const { digests, userId } = await setup();
    const other = await new UserRepository(testDb()).upsertByDiscordId({
      discordUserId: "u2",
      displayName: null,
      isOwner: false,
    });
    const first = await digests.create({ userId, runDate: "2026-06-30", coversSince: new Date() });
    const second = await digests.create({ userId, runDate: "2026-07-01", coversSince: new Date() });
    await digests.create({ userId: other.id, runDate: "2026-07-01", coversSince: new Date() });
    const listed = await digests.listForUser(userId);
    expect(listed.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("findByIdForUser never returns another user's run", async () => {
    const { digests, userId } = await setup();
    const other = await new UserRepository(testDb()).upsertByDiscordId({
      discordUserId: "u2",
      displayName: null,
      isOwner: false,
    });
    const run = await digests.create({ userId, runDate: "2026-07-01", coversSince: new Date() });
    expect((await digests.findByIdForUser(run.id, userId))?.id).toBe(run.id);
    expect(await digests.findByIdForUser(run.id, other.id)).toBeUndefined();
  });

  it("markDelivered and setCostCents update the run", async () => {
    const { digests, userId } = await setup();
    const row = await digests.create({ userId, runDate: "2026-07-01", coversSince: new Date() });
    await digests.setCostCents(row.id, 1.2345);
    await digests.markDelivered(row.id, new Date("2026-07-01T05:01:00Z"));
    const latest = await digests.latestForUser(userId);
    expect(latest?.status).toBe("delivered");
    expect(latest?.delivered_at).not.toBeNull();
    expect(Number(latest?.cost_cents)).toBeCloseTo(1.2345);
  });
});
