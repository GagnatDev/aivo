import { afterEach, describe, expect, it } from "vitest";
import { ModelPricingRepository } from "./modelPricingRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

// model_pricing / model_tier_assignments are not user-scoped, so the per-test TRUNCATE
// doesn't reset them. Restore the migration-seeded state (models plus all four filled
// slots) after each test that mutates it.
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
    inputCostPerMtokCents: 15,
    outputCostPerMtokCents: 35,
    capabilities: ["chat", "audio"],
    audioCostPerMinCents: 0.03,
  });
  await repo.upsertModel({
    modelId: "whisper-large-v3",
    inputCostPerMtokCents: 0,
    outputCostPerMtokCents: 0,
    capabilities: ["audio"],
    audioCostPerMinCents: 0.3,
  });
  await repo.setTierRole("llama-3.1-8b-instruct", "cheap", "chat");
  await repo.setTierRole("llama-3.3-70b-instruct", "premium", "chat");
  await repo.setTierRole("voxtral-small-24b-2507", "cheap", "audio");
  await repo.setTierRole("voxtral-small-24b-2507", "premium", "audio");
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

  it("updatePricing / set_price leaves slot assignments untouched", async () => {
    const repo = new ModelPricingRepository(testDb());
    // upsertModel is what the 'set_price' tool calls; a price refresh must not move slots.
    await repo.upsertModel({
      modelId: "llama-3.3-70b-instruct",
      inputCostPerMtokCents: 81,
      outputCostPerMtokCents: 81,
    });
    expect((await repo.getByTier("premium"))?.model_id).toBe("llama-3.3-70b-instruct");
  });

  it("setTierRole points the slot at the new model, replacing the previous holder", async () => {
    const repo = new ModelPricingRepository(testDb());
    await repo.upsertModel({
      modelId: "new-cheap",
      inputCostPerMtokCents: 10,
      outputCostPerMtokCents: 10,
    });
    // Single capability (the chat default) → no explicit capability needed.
    const res = await repo.setTierRole("new-cheap", "cheap");
    expect(res.ok).toBe(true);
    expect((await repo.getByTier("cheap"))?.model_id).toBe("new-cheap");
    // The old cheap chat model no longer fills any slot.
    const assignments = await repo.listAssignments();
    expect(assignments.some((a) => a.model_id === "llama-3.1-8b-instruct")).toBe(false);
  });

  it("setTierRole reports an unknown model id", async () => {
    const repo = new ModelPricingRepository(testDb());
    expect(await repo.setTierRole("nope", "cheap")).toEqual({
      ok: false,
      reason: "unknown_model",
    });
  });

  it("setTierRole requires an explicit capability for a multi-capability model", async () => {
    const repo = new ModelPricingRepository(testDb());
    // voxtral declares chat+audio, so the slot to assign is ambiguous without it.
    expect(await repo.setTierRole("voxtral-small-24b-2507", "cheap")).toEqual({
      ok: false,
      reason: "ambiguous_capability",
    });
  });

  it("setTierRole refuses a capability the model doesn't declare", async () => {
    const repo = new ModelPricingRepository(testDb());
    expect(await repo.setTierRole("llama-3.1-8b-instruct", "cheap", "audio")).toEqual({
      ok: false,
      reason: "capability_not_held",
    });
    // The audio slot is unchanged.
    expect((await repo.getByTier("cheap", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
  });

  it("getByTier defaults to chat and never resolves through audio slots", async () => {
    const repo = new ModelPricingRepository(testDb());
    // voxtral is chat-CAPABLE but only fills audio slots, so the chat slots stay llamas.
    expect((await repo.getByTier("cheap"))?.model_id).toBe("llama-3.1-8b-instruct");
    expect((await repo.getByTier("premium"))?.model_id).toBe("llama-3.3-70b-instruct");
  });

  it("one model may fill both audio slots", async () => {
    const repo = new ModelPricingRepository(testDb());
    // The seed points cheap AND premium audio at voxtral (degradation is a no-op).
    expect((await repo.getByTier("cheap", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
    expect((await repo.getByTier("premium", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
  });

  it("assigning an audio slot never touches the chat slots", async () => {
    const repo = new ModelPricingRepository(testDb());
    const res = await repo.setTierRole("whisper-large-v3", "premium", "audio");
    expect(res.ok && res.capability).toBe("audio");
    expect((await repo.getByTier("premium", "audio"))?.model_id).toBe("whisper-large-v3");
    // Chat premium and the other audio slot are untouched.
    expect((await repo.getByTier("premium", "chat"))?.model_id).toBe("llama-3.3-70b-instruct");
    expect((await repo.getByTier("cheap", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
  });

  it("a dual-capability model can fill a chat slot alongside its audio slots", async () => {
    const repo = new ModelPricingRepository(testDb());
    // The voxtral-for-chat case: declaring the capability did nothing; assigning does.
    const res = await repo.setTierRole("voxtral-small-24b-2507", "cheap", "chat");
    expect(res.ok).toBe(true);
    expect((await repo.getByTier("cheap", "chat"))?.model_id).toBe("voxtral-small-24b-2507");
    expect((await repo.getByTier("cheap", "audio"))?.model_id).toBe("voxtral-small-24b-2507");
    // The premium chat slot is untouched.
    expect((await repo.getByTier("premium", "chat"))?.model_id).toBe("llama-3.3-70b-instruct");
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
