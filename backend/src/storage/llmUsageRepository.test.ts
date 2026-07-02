import { describe, expect, it } from "vitest";
import { LlmUsageRepository } from "./llmUsageRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const usage = new LlmUsageRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { usage, userId: user.id };
}

describe("LlmUsageRepository", () => {
  it("sums fractional cents across rows without rounding to zero", async () => {
    const { usage, userId } = await setup();
    await usage.insert({
      userId,
      taskType: "chat",
      model: "m",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 0.25,
    });
    await usage.insert({
      userId,
      taskType: "chat",
      model: "m",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 0.1,
    });
    expect(await usage.monthToDateCents(userId)).toBeCloseTo(0.35, 4);
    expect(await usage.todayCents(userId)).toBeCloseTo(0.35, 4);
  });

  it("spendSinceCents is zero with no usage", async () => {
    const { usage, userId } = await setup();
    expect(await usage.spendSinceCents(userId, new Date(0))).toBe(0);
  });

  it("topDrivers groups by model and task_type, biggest first", async () => {
    const { usage, userId } = await setup();
    await usage.insert({
      userId,
      taskType: "chat",
      model: "premium",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 5,
    });
    await usage.insert({
      userId,
      taskType: "chat",
      model: "cheap",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1,
    });
    await usage.insert({
      userId,
      taskType: "chat",
      model: "cheap",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1,
    });
    const drivers = await usage.topDrivers(userId, new Date(0));
    expect(drivers[0]).toMatchObject({ model: "premium", costCents: 5, calls: 1 });
    expect(drivers[1]).toMatchObject({ model: "cheap", costCents: 2, calls: 2 });
  });
});
