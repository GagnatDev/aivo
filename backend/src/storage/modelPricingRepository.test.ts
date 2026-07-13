import { afterEach, describe, expect, it } from "vitest";
import { ModelPricingRepository } from "./modelPricingRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

// model_pricing is not user-scoped, so the per-test TRUNCATE doesn't reset it.
// Restore the migration-seeded state (both the chat and audio tiers) after each test
// that mutates it.
afterEach(async () => {
  const repo = new ModelPricingRepository(testDb());
  await repo.upsertModel({
    modelId: "llama-3.1-8b-instruct",
    inputCostPerMtokCents: 20,
    outputCostPerMtokCents: 20,
    capabilities: ["chat"],
  });
  await repo.upsertModel({
    modelId: "llama-3.3-70b-instruct",
    inputCostPerMtokCents: 90,
    outputCostPerMtokCents: 90,
    capabilities: ["chat"],
  });
  await repo.upsertModel({
    modelId: "voxtral-small-24b-2507",
    inputCostPerMtokCents: 0,
    outputCostPerMtokCents: 0,
    capabilities: ["audio"],
    audioCostPerMinCents: 10,
  });
  await repo.upsertModel({
    modelId: "whisper-large-v3",
    inputCostPerMtokCents: 0,
    outputCostPerMtokCents: 0,
    capabilities: ["audio"],
    audioCostPerMinCents: 3,
  });
  await repo.setTierRole("llama-3.1-8b-instruct", "cheap");
  await repo.setTierRole("llama-3.3-70b-instruct", "premium");
  await repo.setTierRole("whisper-large-v3", "cheap");
  await repo.setTierRole("voxtral-small-24b-2507", "premium");
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

  it("getByTier defaults to chat and never returns an audio-only model", async () => {
    const repo = new ModelPricingRepository(testDb());
    // whisper is the cheap AUDIO model; the cheap CHAT model is still the llama.
    expect((await repo.getByTier("cheap"))?.model_id).toBe("llama-3.1-8b-instruct");
    expect((await repo.getByTier("premium"))?.model_id).toBe("llama-3.3-70b-instruct");
  });

  it("resolves audio models by tier via the capability filter", async () => {
    const repo = new ModelPricingRepository(testDb());
    expect((await repo.getByTier("cheap", "audio"))?.model_id).toBe("whisper-large-v3");
    expect((await repo.getByTier("premium", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
  });

  it("keeps one premium chat and one premium audio model at once", async () => {
    const repo = new ModelPricingRepository(testDb());
    // The seed already has both premium roles filled in different capability domains.
    expect((await repo.getByTier("premium", "chat"))?.model_id).toBe("llama-3.3-70b-instruct");
    expect((await repo.getByTier("premium", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
  });

  it("assigning the premium audio role does not strip the premium chat model", async () => {
    const repo = new ModelPricingRepository(testDb());
    // Re-assert voxtral as premium audio; the scoped clear must leave the chat premium alone.
    await repo.setTierRole("voxtral-small-24b-2507", "premium");
    expect((await repo.getByModelId("llama-3.3-70b-instruct"))?.tier_role).toBe("premium");
    expect((await repo.getByModelId("voxtral-small-24b-2507"))?.tier_role).toBe("premium");
  });

  it("swapping the premium audio model clears the previous audio holder only", async () => {
    const repo = new ModelPricingRepository(testDb());
    await repo.upsertModel({
      modelId: "voxtral-next",
      inputCostPerMtokCents: 0,
      outputCostPerMtokCents: 0,
      capabilities: ["audio"],
      audioCostPerMinCents: 12,
    });
    await repo.setTierRole("voxtral-next", "premium");
    expect((await repo.getByTier("premium", "audio"))?.model_id).toBe("voxtral-next");
    // Old audio premium cleared; chat premium untouched.
    expect((await repo.getByModelId("voxtral-small-24b-2507"))?.tier_role).toBeNull();
    expect((await repo.getByModelId("llama-3.3-70b-instruct"))?.tier_role).toBe("premium");
  });

  it("upsertModel stores capabilities and an audio per-minute price", async () => {
    const repo = new ModelPricingRepository(testDb());
    const row = await repo.upsertModel({
      modelId: "some-audio-model",
      inputCostPerMtokCents: 0,
      outputCostPerMtokCents: 0,
      capabilities: ["audio"],
      audioCostPerMinCents: 7.5,
    });
    expect(row.capabilities).toEqual(["audio"]);
    expect(Number(row.audio_cost_per_min_cents)).toBe(7.5);
  });
});
