import { describe, expect, it } from "vitest";
import { FeedbackRepository } from "./feedbackRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const feedback = new FeedbackRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { feedback, userId: user.id };
}

describe("FeedbackRepository", () => {
  it("inserts and lists unapplied feedback oldest-first, markApplied clears it", async () => {
    const { feedback, userId } = await setup();
    const first = await feedback.insert({ userId, signal: "freeform", freeformText: "no shorts" });
    await feedback.insert({ userId, signal: "keep" });
    const unapplied = await feedback.listUnapplied(userId);
    expect(unapplied).toHaveLength(2);
    expect(unapplied[0].id).toBe(first.id);
    await feedback.markApplied(unapplied.map((f) => f.id));
    expect(await feedback.listUnapplied(userId)).toHaveLength(0);
  });

  it("agreementStats counts keep as agreement and excludes freeform", async () => {
    const { feedback, userId } = await setup();
    const since = new Date(Date.now() - 60_000);
    await feedback.insert({ userId, signal: "keep" });
    await feedback.insert({ userId, signal: "keep" });
    await feedback.insert({ userId, signal: "drop" });
    await feedback.insert({ userId, signal: "wrong_topic" });
    await feedback.insert({ userId, signal: "freeform", freeformText: "meh" });
    const stats = await feedback.agreementStats(userId, since);
    expect(stats.samples).toBe(4);
    expect(stats.rate).toBeCloseTo(0.5);
  });

  it("agreementStats is zero-safe with no samples", async () => {
    const { feedback, userId } = await setup();
    expect(await feedback.agreementStats(userId, new Date())).toEqual({ samples: 0, rate: 0 });
  });
});
