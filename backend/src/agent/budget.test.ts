import { describe, expect, it } from "vitest";
import {
  computeAudioCostCents,
  computeCostCents,
  deriveState,
  loadBudgetSnapshot,
  preCallCheck,
  recordTranscriptionUsage,
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

  it("bills prompt-cache hits at the cached input price", () => {
    // deepseek-v4-flash shape: 1M in of which 800k cached, 0 out.
    // 200k @ 40¢ + 800k @ 8¢ = 8¢ + 6.4¢ = 14.4¢ (vs 40¢ uncached).
    const cost = computeCostCents(
      { inputCostPerMtokCents: 40, cachedInputCostPerMtokCents: 8, outputCostPerMtokCents: 80 },
      { tokensIn: 1_000_000, tokensCached: 800_000, tokensOut: 0 },
    );
    expect(cost).toBeCloseTo(14.4, 6);
  });

  it("bills cache hits at the full input price when the model has no cached price", () => {
    const cost = computeCostCents(
      { inputCostPerMtokCents: 40, cachedInputCostPerMtokCents: null, outputCostPerMtokCents: 80 },
      { tokensIn: 1_000_000, tokensCached: 800_000, tokensOut: 0 },
    );
    expect(cost).toBeCloseTo(40, 6);
  });

  it("never discounts more tokens than were sent", () => {
    const cost = computeCostCents(
      { inputCostPerMtokCents: 40, cachedInputCostPerMtokCents: 8, outputCostPerMtokCents: 80 },
      { tokensIn: 1_000_000, tokensCached: 5_000_000, tokensOut: 0 },
    );
    expect(cost).toBeCloseTo(8, 6);
  });

  it("ignores a negative or non-finite cache-hit count instead of billing extra input", () => {
    const pricing = {
      inputCostPerMtokCents: 40,
      cachedInputCostPerMtokCents: 8,
      outputCostPerMtokCents: 80,
    };
    // 1M in @ 40¢, no discount: a negative count must not add tokens to the bill.
    expect(
      computeCostCents(pricing, { tokensIn: 1_000_000, tokensCached: -100_000, tokensOut: 0 }),
    ).toBeCloseTo(40, 6);
    expect(
      computeCostCents(pricing, { tokensIn: 1_000_000, tokensCached: Number.NaN, tokensOut: 0 }),
    ).toBeCloseTo(40, 6);
  });
});

describe("computeAudioCostCents", () => {
  it("prorates the per-minute rate by the clip duration", () => {
    // 3¢/min for a 30s clip = 1.5¢.
    expect(computeAudioCostCents(3, 30)).toBeCloseTo(1.5, 6);
    // 10¢/min for a 12s clip = 2¢.
    expect(computeAudioCostCents(10, 12)).toBeCloseTo(2, 6);
  });
});

describe("recordTranscriptionUsage", () => {
  it("writes an stt ledger row with cost from duration and zero tokens", async () => {
    const { deps, userId } = await setup();
    // whisper seed = 0.3¢/min audio; a 60s clip costs 0.3¢.
    const rec = await recordTranscriptionUsage(deps, userId, "whisper-large-v3", 60);
    expect(rec.costCents).toBeCloseTo(0.3, 4);
    expect(await deps.llmUsage.monthToDateCents(userId)).toBeCloseTo(0.3, 4);
    const rows = await deps.llmUsage.listRows(userId, {
      from: new Date(0),
      to: new Date(Date.now() + 60_000),
      limit: 10,
    });
    expect(rows[0]).toMatchObject({ taskType: "stt", tokensIn: 0, tokensOut: 0 });
  });

  it("fires a budget alert when the stt cost crosses a threshold", async () => {
    const { deps, userId } = await setup();
    await deps.budgetConfig.update(userId, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "x",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 49.9,
    });
    // whisper seed = 0.3¢/min; a 60s clip adds 0.3¢ → 50.2% (crosses the 50 threshold).
    const rec = await recordTranscriptionUsage(deps, userId, "whisper-large-v3", 60);
    expect(rec.alertPct).toBe(50);
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
  it("pauses proactive work at 90% of ceiling", () => {
    expect(deriveState({ ...base, monthToDateCents: 900 })).toBe("proactive_paused");
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

  it("applies the cached input price and records the cache hits on the ledger", async () => {
    const { deps, userId } = await setup();
    // Seeded by migration 028: 40¢ in / 8¢ cached / 80¢ out per Mtok.
    const record = await recordUsageAndAlert(deps, userId, "chat", "deepseek-v4-flash-0731", {
      tokensIn: 1_000_000,
      tokensCached: 800_000,
      tokensOut: 0,
    });
    expect(record.costCents).toBeCloseTo(14.4, 4);
    const [row] = await deps.llmUsage.listRows(userId, {
      from: new Date(0),
      to: new Date(Date.now() + 60_000),
      limit: 10,
    });
    expect(row?.tokensIn).toBe(1_000_000);
    expect(row?.tokensCached).toBe(800_000);
  });

  it("stores the same clamped cache-hit count the cost was computed from", async () => {
    const { deps, userId } = await setup();
    const record = await recordUsageAndAlert(deps, userId, "chat", "deepseek-v4-flash-0731", {
      tokensIn: 1_000_000,
      tokensCached: 5_000_000,
      tokensOut: 0,
    });
    // All of tokensIn at the 8¢ cached rate.
    expect(record.costCents).toBeCloseTo(8, 4);
    const [row] = await deps.llmUsage.listRows(userId, {
      from: new Date(0),
      to: new Date(Date.now() + 60_000),
      limit: 10,
    });
    expect(row?.tokensCached).toBe(1_000_000);
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
