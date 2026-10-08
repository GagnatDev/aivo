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

  it("modelTotals sums prompt-cache hits per model; rows without them count 0", async () => {
    const { usage, userId } = await setup();
    const base = { userId, taskType: "chat", model: "m", tokensOut: 1, costCents: 0.1 };
    await usage.insert({ ...base, tokensIn: 1000, tokensCached: 600 });
    await usage.insert({ ...base, tokensIn: 1000 });
    const [total] = await usage.modelTotals(userId, new Date(0));
    expect(total?.tokensIn).toBe(2000);
    expect(total?.tokensCached).toBe(600);
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

describe("LlmUsageRepository.dailySeries", () => {
  async function seedAt(userId: string, createdAt: Date, model: string, costCents: number) {
    await testDb()
      .insertInto("llm_usage")
      .values({
        user_id: userId,
        task_type: "chat",
        model,
        tokens_in: 10,
        tokens_out: 5,
        cost_cents: costCents,
        created_at: createdAt,
      })
      .execute();
  }

  it("buckets by UTC day, ordered ascending, summing cost and tokens", async () => {
    const { usage, userId } = await setup();
    await seedAt(userId, new Date("2026-06-05T23:59:00Z"), "m1", 1.5);
    await seedAt(userId, new Date("2026-06-05T01:00:00Z"), "m1", 0.5);
    await seedAt(userId, new Date("2026-06-01T00:00:00Z"), "m1", 4);

    const buckets = await usage.dailySeries(userId, {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-07-01T00:00:00Z"),
    });
    expect(buckets).toEqual([
      { day: "2026-06-01", group: null, costCents: 4, calls: 1, tokensIn: 10, tokensOut: 5 },
      { day: "2026-06-05", group: null, costCents: 2, calls: 2, tokensIn: 20, tokensOut: 10 },
    ]);
  });

  it("splits a day into one bucket per group with groupBy", async () => {
    const { usage, userId } = await setup();
    await seedAt(userId, new Date("2026-06-02T08:00:00Z"), "cheap-1", 1);
    await seedAt(userId, new Date("2026-06-02T09:00:00Z"), "premium-1", 2);

    const buckets = await usage.dailySeries(userId, {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-08T00:00:00Z"),
      groupBy: "model",
    });
    expect(buckets.map((b) => [b.day, b.group, b.costCents])).toEqual([
      ["2026-06-02", "cheap-1", 1],
      ["2026-06-02", "premium-1", 2],
    ]);
  });

  it("treats `to` as exclusive", async () => {
    const { usage, userId } = await setup();
    await seedAt(userId, new Date("2026-06-08T00:00:00Z"), "m1", 9);
    const buckets = await usage.dailySeries(userId, {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-08T00:00:00Z"),
    });
    expect(buckets).toEqual([]);
  });
});
