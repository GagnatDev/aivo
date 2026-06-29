import { describe, expect, it } from "vitest";
import { BudgetConfigRepository } from "./budgetConfigRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const budgets = new BudgetConfigRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { budgets, userId: user.id };
}

describe("BudgetConfigRepository", () => {
  it("getOrCreate provisions defaults and is idempotent", async () => {
    const { budgets, userId } = await setup();
    const row = await budgets.getOrCreate(userId);
    expect(row.monthly_ceiling_cents).toBe(1500);
    expect(row.alert_thresholds).toEqual([50, 80, 100]);
    expect(row.degradation_state).toBe("normal");
    expect((await budgets.getOrCreate(userId)).user_id).toBe(row.user_id);
  });

  it("update sets caps and the approval threshold", async () => {
    const { budgets, userId } = await setup();
    const row = await budgets.update(userId, {
      monthly_ceiling_cents: 2000,
      daily_soft_cap_cents: 200,
      approval_threshold_cents: 50,
    });
    expect(row.monthly_ceiling_cents).toBe(2000);
    expect(row.daily_soft_cap_cents).toBe(200);
    expect(row.approval_threshold_cents).toBe(50);
  });

  it("persists degradation state and alert watermark", async () => {
    const { budgets, userId } = await setup();
    await budgets.getOrCreate(userId);
    await budgets.setDegradationState(userId, "cheap_models");
    await budgets.recordAlert(userId, 80);
    const row = await budgets.getOrCreate(userId);
    expect(row.degradation_state).toBe("cheap_models");
    expect(row.last_alerted_pct).toBe(80);
  });
});
