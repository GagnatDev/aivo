import { describe, expect, it } from "vitest";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { testDb, useCleanDb } from "../../test/db.js";
import { makeFakeLlm, textResult, type FakeLlm } from "../../test/fakeLlm.js";
import type { TranscriptSource } from "../../youtube/transcripts.js";
import { systemClock } from "../clock.js";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";

useCleanDb();

const registry = buildToolRegistry();
const tool = (): AgentTool => {
  const t = registry.find((x) => x.schema.name === "youtube_summary");
  if (!t) throw new Error("no youtube_summary tool");
  return t;
};

const VIDEO_ID = "dQw4w9WgXcQ";
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

/** A TranscriptSource fake that records lookups; unknown ids yield null. */
function fakeTranscripts(byId: Record<string, string>): TranscriptSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchTranscript(videoId) {
      calls.push(videoId);
      return byId[videoId] ?? null;
    },
  };
}

async function ctxFor(
  discordId: string,
  llm: FakeLlm = makeFakeLlm([textResult("- a point\n- another point")]),
  transcripts: TranscriptSource = fakeTranscripts({ [VIDEO_ID]: "we talk about rockets" }),
): Promise<ToolContext> {
  const deps = makeAgentDeps(llm, {}, systemClock, null, null, null, transcripts);
  const { userId, isOwner, conversationId } = await provisionUser(deps, discordId);
  return { deps, userId, isOwner, conversationId, language: "nb" };
}

describe("youtube_summary tool — summarizing", () => {
  it("summarizes a pasted URL via a premium-tier sub-call fed the transcript", async () => {
    const llm = makeFakeLlm([textResult("- rockets go up\n- rockets come down")]);
    const ctx = await ctxFor(OWNER_ID, llm);

    const out = await tool().execute({ video: `https://youtu.be/${VIDEO_ID}` }, ctx);
    expect(out).toContain("rockets go up");
    expect(out).toContain(WATCH_URL);

    // Premium chat slot (migration seed), transcript in the prompt, output in the
    // user's configured language.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].model).toBe("llama-3.3-70b-instruct");
    expect(llm.calls[0].messages[1].content).toContain("we talk about rockets");
    expect(llm.calls[0].messages[0].content).toContain("Norwegian");
  });

  it("meters the sub-call as its own video_summary task type", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await tool().execute({ video: VIDEO_ID }, ctx);

    const rows = await testDb()
      .selectFrom("llm_usage")
      .select(["task_type", "model"])
      .where("task_type", "=", "video_summary")
      .execute();
    expect(rows).toEqual([{ task_type: "video_summary", model: "llama-3.3-70b-instruct" }]);
  });

  it("caps an outlier transcript before prompting (stage-2 volume guard)", async () => {
    const llm = makeFakeLlm([textResult("- long video")]);
    const huge = `${"x".repeat(16_000)}NEVER_SENT_TAIL`;
    const ctx = await ctxFor(OWNER_ID, llm, fakeTranscripts({ [VIDEO_ID]: huge }));

    await tool().execute({ video: VIDEO_ID }, ctx);
    expect(llm.calls[0].messages[1].content).not.toContain("NEVER_SENT_TAIL");
  });

  it("drops to the cheap model under budget degradation", async () => {
    const llm = makeFakeLlm([textResult("- brief point")]);
    const ctx = await ctxFor(OWNER_ID, llm);
    // 85% of a 100-cent ceiling → cheap_models state coerces the premium request down.
    await ctx.deps.budgetConfig.update(ctx.userId, { monthly_ceiling_cents: 100 });
    await ctx.deps.llmUsage.insert({
      userId: ctx.userId,
      taskType: "chat",
      model: "x",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 85,
    });

    const out = await tool().execute({ video: VIDEO_ID }, ctx);
    expect(out).toContain("brief point");
    expect(llm.calls[0].model).toBe("llama-3.1-8b-instruct");
  });

  it("is open to non-owners, metered on their own budget", async () => {
    const ctx = await ctxFor("member-1");
    expect(ctx.isOwner).toBe(false);
    const out = await tool().execute({ video: VIDEO_ID }, ctx);
    expect(out).toContain("a point");
  });
});

describe("youtube_summary tool — failure modes", () => {
  it("reports an unrecognizable video reference without spending anything", async () => {
    const llm = makeFakeLlm([]);
    const transcripts = fakeTranscripts({});
    const ctx = await ctxFor(OWNER_ID, llm, transcripts);

    const out = await tool().execute({ video: "that video about rockets" }, ctx);
    expect(out).toContain("doesn't look like a YouTube URL");
    expect(transcripts.calls).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it("says so when the video has no transcript, without an LLM call", async () => {
    const llm = makeFakeLlm([]);
    const ctx = await ctxFor(OWNER_ID, llm, fakeTranscripts({}));

    const out = await tool().execute({ video: WATCH_URL }, ctx);
    expect(out).toContain("No transcript is available");
    expect(out).toContain(WATCH_URL);
    expect(llm.calls).toHaveLength(0);
  });

  it("reports a failed sub-call without confabulating a summary", async () => {
    const ctx = await ctxFor(OWNER_ID, makeFakeLlm([new Error("provider down")]));
    const out = await tool().execute({ video: VIDEO_ID }, ctx);
    expect(out).toContain("failed");
  });

  it("reports an empty model response instead of returning a blank summary", async () => {
    const ctx = await ctxFor(OWNER_ID, makeFakeLlm([textResult("   ")]));
    const out = await tool().execute({ video: VIDEO_ID }, ctx);
    expect(out).toContain("empty summary");
  });

  it("rejects missing arguments with a recoverable error", async () => {
    const ctx = await ctxFor(OWNER_ID);
    expect(await tool().execute({}, ctx)).toContain("Invalid arguments");
  });
});
