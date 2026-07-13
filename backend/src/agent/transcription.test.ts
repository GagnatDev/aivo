import { afterEach, describe, expect, it } from "vitest";
import { transcribeVoiceMessage, type VoiceAttachment } from "./transcription.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { makeAgentDeps, provisionUser } from "../test/agentDeps.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { testDb, useCleanDb } from "../test/db.js";
import type { AgentDeps } from "./deps.js";

useCleanDb();

// model_pricing is not user-scoped; restore the audio seed after tests that mutate it.
afterEach(async () => {
  const repo = new ModelPricingRepository(testDb());
  await repo.upsertModel({
    modelId: "voxtral-small-24b-2507",
    inputCostPerMtokCents: 15,
    outputCostPerMtokCents: 35,
    capabilities: ["audio"],
    audioCostPerMinCents: 0.03,
  });
  await repo.upsertModel({
    modelId: "whisper-large-v3",
    inputCostPerMtokCents: 0,
    outputCostPerMtokCents: 0,
    capabilities: ["audio"],
    audioCostPerMinCents: 0.3,
  });
  await repo.setTierRole("voxtral-small-24b-2507", "cheap");
  await repo.setTierRole("whisper-large-v3", "premium");
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

  it("transcribes with the cheap audio model and meters an stt ledger row", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "  hello from a voice note  " } });
    const { deps, userId } = await setup(llm);
    const dl = stubDownload();
    const out = await transcribeVoiceMessage(deps, userId, voice({ durationSecs: 30 }), dl.fn);

    expect(out).toMatchObject({ kind: "ok", text: "hello from a voice note" });
    expect(dl.urls).toEqual(["https://cdn.example/voice.ogg"]);
    // Transcription requests the cheap tier outright → voxtral.
    expect(llm.transcribeCalls[0]?.model).toBe("voxtral-small-24b-2507");
    // voxtral seed = 0.03¢/min; 30s → 0.015¢ on the stt ledger.
    expect(await deps.llmUsage.monthToDateCents(userId)).toBeCloseTo(0.015, 6);
  });

  it("stays on the cheap audio model under budget pressure", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "cheap tier please" } });
    const { deps, userId } = await setup(llm);
    // Push month-to-date to 85% of the ceiling → cheap_models degradation. Transcription
    // already requests cheap, so the coercion is a no-op and voxtral keeps transcribing.
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

  it("falls back to the premium audio model when the cheap role is unheld", async () => {
    const llm = makeFakeLlm([], { transcript: { text: "premium fallback" } });
    const { deps, userId } = await setup(llm);
    await testDb()
      .updateTable("model_pricing")
      .set({ tier_role: null })
      .where("model_id", "=", "voxtral-small-24b-2507")
      .execute();
    const out = await transcribeVoiceMessage(deps, userId, voice(), stubDownload().fn);
    expect(out.kind).toBe("ok");
    expect(llm.transcribeCalls[0]?.model).toBe("whisper-large-v3");
  });

  it("reports unavailable when no audio model is configured", async () => {
    const llm = makeFakeLlm([]);
    const { deps, userId } = await setup(llm);
    // Clear the audio tier roles so neither audio tier resolves.
    await testDb()
      .updateTable("model_pricing")
      .set({ tier_role: null })
      .where("model_id", "in", ["voxtral-small-24b-2507", "whisper-large-v3"])
      .execute();
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
