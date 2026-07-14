import { afterEach, describe, expect, it } from "vitest";
import { transcribeVoiceMessage, type VoiceAttachment } from "./transcription.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { makeAgentDeps, provisionUser } from "../test/agentDeps.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { testDb, useCleanDb } from "../test/db.js";
import type { AgentDeps } from "./deps.js";

useCleanDb();

// model_pricing / model_tier_assignments are not user-scoped; restore the audio seed
// (voxtral filling both audio slots, whisper priced but unassigned) after tests that
// mutate it.
afterEach(async () => {
  const repo = new ModelPricingRepository(testDb());
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
  await repo.setTierRole("voxtral-small-24b-2507", "cheap", "audio");
  await repo.setTierRole("voxtral-small-24b-2507", "premium", "audio");
});

const voice = (over: Partial<VoiceAttachment> = {}): VoiceAttachment => ({
  url: "https://cdn.example/voice.ogg",
  contentType: "audio/ogg",
  durationSecs: 10,
  sizeBytes: 50_000,
  filename: "voice-message.ogg",
  ...over,
});

/** A download stub that records the URLs it was asked to fetch. */
function stubDownload() {
  const urls: string[] = [];
  const fn = async (url: string): Promise<Buffer> => {
    urls.push(url);
    return Buffer.from("audio-bytes");
  };
  return { fn, urls };
}

async function setup(llm = makeFakeLlm([])): Promise<{ deps: AgentDeps; userId: string }> {
  const deps = makeAgentDeps(llm);
  const { userId } = await provisionUser(deps, "voice-user");
  return { deps, userId };
}

describe("transcribeVoiceMessage", () => {
  it("rejects an over-long note before downloading or transcribing", async () => {
    const llm = makeFakeLlm([]);
    const { deps, userId } = await setup(llm);
    const dl = stubDownload();
    const out = await transcribeVoiceMessage(
      deps,
      userId,
      voice({ durationSecs: deps.config.voiceMaxDurationSecs + 1 }),
      dl.fn,
    );
    expect(out.kind).toBe("rejected");
    expect(dl.urls).toHaveLength(0);
    expect(llm.transcribeCalls).toHaveLength(0);
  });

  it("rejects an over-size note before downloading", async () => {
    const llm = makeFakeLlm([]);
    const { deps, userId } = await setup(llm);
    const dl = stubDownload();
    const out = await transcribeVoiceMessage(
      deps,
      userId,
      voice({ sizeBytes: deps.config.voiceMaxBytes + 1 }),
      dl.fn,
    );
    expect(out.kind).toBe("rejected");
    expect(dl.urls).toHaveLength(0);
  });

  it("transcribes and meters an stt ledger row", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "  hello from a voice note  " } });
    const { deps, userId } = await setup(llm);
    const dl = stubDownload();
    const out = await transcribeVoiceMessage(deps, userId, voice({ durationSecs: 30 }), dl.fn);

    expect(out).toMatchObject({ kind: "ok", text: "hello from a voice note" });
    expect(dl.urls).toEqual(["https://cdn.example/voice.ogg"]);
    // Default tier is `auto` (→ premium), and the seed points both audio slots at voxtral.
    expect(llm.transcribeCalls[0]?.model).toBe("voxtral-small-24b-2507");
    // voxtral seed = 0.03¢/min; 30s → 0.015¢ on the stt ledger.
    expect(await deps.llmUsage.monthToDateCents(userId)).toBeCloseTo(0.015, 6);
  });

  it("respects the user's model-tier preference for the audio slot", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "premium please" } });
    const { deps, userId } = await setup(llm);
    // Give the premium and cheap audio slots distinct models, then set the user to premium.
    await deps.modelPricing.setTierRole("whisper-large-v3", "premium", "audio");
    await deps.settings.update(userId, { model_tier: "premium" });
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("ok");
    expect(llm.transcribeCalls[0]?.model).toBe("whisper-large-v3");
  });

  it("uses the cheap audio slot when the user prefers the cheap tier", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "cheap please" } });
    const { deps, userId } = await setup(llm);
    await deps.modelPricing.setTierRole("whisper-large-v3", "premium", "audio");
    await deps.settings.update(userId, { model_tier: "cheap" });
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("ok");
    expect(llm.transcribeCalls[0]?.model).toBe("voxtral-small-24b-2507");
  });

  it("coerces a premium preference down to the cheap audio slot under budget pressure", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "cheap tier please" } });
    const { deps, userId } = await setup(llm);
    // Premium user + a distinct premium audio model; budget pressure must still force cheap.
    await deps.modelPricing.setTierRole("whisper-large-v3", "premium", "audio");
    await deps.settings.update(userId, { model_tier: "premium" });
    // Push month-to-date to 85% of the ceiling → cheap_models degradation coerces to cheap.
    await deps.budgetConfig.update(userId, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "x",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 85,
    });
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("ok");
    expect(llm.transcribeCalls[0]?.model).toBe("voxtral-small-24b-2507");
  });

  it("falls back to the premium audio slot when the cheap one is unassigned", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "premium fallback" } });
    const { deps, userId } = await setup(llm);
    // Point the premium audio slot at whisper and empty the cheap one.
    await deps.modelPricing.setTierRole("whisper-large-v3", "premium", "audio");
    await testDb()
      .deleteFrom("model_tier_assignments")
      .where("capability", "=", "audio")
      .where("tier_role", "=", "cheap")
      .execute();
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("ok");
    expect(llm.transcribeCalls[0]?.model).toBe("whisper-large-v3");
  });

  it("reports unavailable when no audio slot is assigned", async () => {
    const llm = makeFakeLlm([]);
    const { deps, userId } = await setup(llm);
    await testDb().deleteFrom("model_tier_assignments").where("capability", "=", "audio").execute();
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("unavailable");
    expect(llm.transcribeCalls).toHaveLength(0);
  });

  it("reports unavailable and writes no ledger row when the provider fails", async () => {
    const llm = makeFakeLlm([], { transcript: new Error("stt down") });
    const { deps, userId } = await setup(llm);
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("unavailable");
    expect(await deps.llmUsage.monthToDateCents(userId)).toBe(0);
  });

  it("reports unavailable when the download fails", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "never reached" } });
    const { deps, userId } = await setup(llm);
    const failing = async (): Promise<Buffer> => {
      throw new Error("404");
    };
    const out = await transcribeVoiceMessage(deps, userId, voice(), failing);
    expect(out.kind).toBe("unavailable");
    expect(llm.transcribeCalls).toHaveLength(0);
  });
});
