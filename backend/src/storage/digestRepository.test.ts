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
