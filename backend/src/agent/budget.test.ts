import { describe, expect, it } from "vitest";
import {
  computeCostCents,
  deriveState,
  loadBudgetSnapshot,
  preCallCheck,
  recordUsageAndAlert,
  type BudgetDeps,
} from "./budget.js";
import { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const deps: BudgetDeps = {
    budgetConfig: new BudgetConfigRepository(db),
    llmUsage: new LlmUsageRepository(db),
    modelPricing: new ModelPricingRepository(db),
  };
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { deps, userId: user.id };
}

describe("computeCostCents", () => {
  it("computes fractional cents from per-Mtok prices", () => {
    // 1000 in @ 90¢/Mtok + 500 out @ 90¢/Mtok = (1000*90 + 500*90)/1e6 = 0.135¢
    const cost = computeCostCents(
      { inputCostPerMtokCents: 90, outputCostPerMtokCents: 90 },
      { tokensIn: 1000, tokensOut: 500 },
    );
    expect(cost).toBeCloseTo(0.135, 6);
  });
});

describe("deriveState", () => {
  const base = {
    monthlyCeilingCents: 1000,
    monthToDateCents: 0,
    dailyCents: 0,
    dailySoftCapCents: null,
  };
  it("is normal under 80%", () => {
    expect(deriveState({ ...base, monthToDateCents: 700 })).toBe("normal");
  });
  it("drops to cheap_models at 80% of ceiling", () => {
    expect(deriveState({ ...base, monthToDateCents: 800 })).toBe("cheap_models");
  });
  it("drops to cheap_models when the daily soft cap is hit", () => {
    expect(deriveState({ ...base, dailyCents: 200, dailySoftCapCents: 200 })).toBe("cheap_models");
  });
  it("is over_ceiling at the monthly ceiling", () => {
    expect(deriveState({ ...base, monthToDateCents: 1000 })).toBe("over_ceiling");
  });
});

describe("preCallCheck", () => {
  it("keeps the requested tier when normal", async () => {
    const { deps, userId } = await setup();
    const decision = await preCallCheck(deps, userId, "premium");
    expect(decision).toMatchObject({ allowed: true, coercedTier: "premium" });
    expect(decision.overBudgetNote).toBeUndefined();
  });

  it("coerces to cheap and adds a note when over the ceiling", async () => {
    const { deps, userId } = await setup();
    await deps.budgetConfig.update(userId, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "m",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 120,
    });
    const decision = await preCallCheck(deps, userId, "premium");
    expect(decision.coercedTier).toBe("cheap");
    expect(decision.overBudgetNote).toBeTruthy();
    // State is persisted.
    expect((await loadBudgetSnapshot(deps, userId)).state).toBe("over_ceiling");
  });
});

describe("recordUsageAndAlert", () => {
  it("writes a ledger row with cost from the model's pricing", async () => {
    const { deps, userId } = await setup();
    // premium seed = 90¢/Mtok in+out.
    await recordUsageAndAlert(deps, userId, "chat", "llama-3.3-70b-instruct", {
      tokensIn: 1_000_000,
      tokensOut: 0,
    });
    expect(await deps.llmUsage.monthToDateCents(userId)).toBeCloseTo(90, 4);
  });

  it("fires an alert once per threshold crossing, not on every call", async () => {
    const { deps, userId } = await setup();
    await deps.budgetConfig.update(userId, { monthly_ceiling_cents: 100 });
    // First call pushes month-to-date to 60% (crosses the 50 threshold).
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "x",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 60,
    });
    const first = await recordUsageAndAlert(deps, userId, "chat", "x", {
      tokensIn: 0,
      tokensOut: 0,
    });
    expect(first.alertPct).toBe(50);
    // Next small call stays in the 50–80 band: no new alert.
    const second = await recordUsageAndAlert(deps, userId, "chat", "x", {
      tokensIn: 0,
      tokensOut: 0,
    });
    expect(second.alertPct).toBeUndefined();
  });
});
