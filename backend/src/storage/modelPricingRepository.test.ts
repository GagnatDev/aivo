import { afterEach, describe, expect, it } from "vitest";
import { ModelPricingRepository } from "./modelPricingRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

// model_pricing is not user-scoped, so the per-test TRUNCATE doesn't reset it.
// Restore the migration-seeded state after each test that mutates it.
afterEach(async () => {
  const repo = new ModelPricingRepository(testDb());
  await repo.upsertModel({
    modelId: "llama-3.1-8b-instruct",
    inputCostPerMtokCents: 20,
    outputCostPerMtokCents: 20,
  });
  await repo.upsertModel({
    modelId: "llama-3.3-70b-instruct",
    inputCostPerMtokCents: 90,
    outputCostPerMtokCents: 90,
  });
  await repo.setTierRole("llama-3.1-8b-instruct", "cheap");
  await repo.setTierRole("llama-3.3-70b-instruct", "premium");
});

describe("ModelPricingRepository", () => {
  it("resolves the seeded cheap and premium models", async () => {
    const repo = new ModelPricingRepository(testDb());
    expect((await repo.getByTier("cheap"))?.model_id).toBe("llama-3.1-8b-instruct");
    expect((await repo.getByTier("premium"))?.model_id).toBe("llama-3.3-70b-instruct");
  });

  it("updatePricing changes the prices of an existing model", async () => {
    const repo = new ModelPricingRepository(testDb());
    const updated = await repo.updatePricing("llama-3.1-8b-instruct", {
      inputCostPerMtokCents: 15,
      outputCostPerMtokCents: 25,
    });
    expect(Number(updated?.input_cost_per_mtok_cents)).toBe(15);
    expect(Number(updated?.output_cost_per_mtok_cents)).toBe(25);
  });

  it("updatePricing returns undefined for an unknown model", async () => {
    const repo = new ModelPricingRepository(testDb());
    expect(
      await repo.updatePricing("nope", { inputCostPerMtokCents: 1, outputCostPerMtokCents: 1 }),
    ).toBeUndefined();
  });

  it("updatePricing / set_price preserves an existing tier_role", async () => {
    const repo = new ModelPricingRepository(testDb());
    // upsertModel is what the 'set_price' tool calls; it must not clear the role.
    await repo.upsertModel({
      modelId: "llama-3.3-70b-instruct",
      inputCostPerMtokCents: 81,
      outputCostPerMtokCents: 81,
    });
    expect((await repo.getByModelId("llama-3.3-70b-instruct"))?.tier_role).toBe("premium");
  });

  it("setTierRole moves the role and clears it from the previous holder", async () => {
    const repo = new ModelPricingRepository(testDb());
    await repo.upsertModel({
      modelId: "new-cheap",
      inputCostPerMtokCents: 10,
      outputCostPerMtokCents: 10,
    });
    await repo.setTierRole("new-cheap", "cheap");
    expect((await repo.getByTier("cheap"))?.model_id).toBe("new-cheap");
    // The old cheap model no longer holds the role.
    expect((await repo.getByModelId("llama-3.1-8b-instruct"))?.tier_role).toBeNull();
  });
});
