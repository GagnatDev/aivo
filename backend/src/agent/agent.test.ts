import { describe, expect, it } from "vitest";
import { runAgent, resumeApprovedAgent } from "./agent.js";
import { LlmProviderError } from "../llm/errors.js";
import {
  makeFakeLlm,
  textResult,
  toolCallResult,
  truncatedToolCallResult,
} from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

describe("runAgent", () => {
  it("returns a plain reply and meters one usage row", async () => {
    const llm = makeFakeLlm([textResult("Noted.")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Noted.");
    expect(llm.calls).toHaveLength(1);
    // premium tier resolved → premium seed model.
    expect(llm.calls[0]?.model).toBe("llama-3.3-70b-instruct");
    expect(await deps.llmUsage.monthToDateCents(userId)).toBeGreaterThan(0);
  });

  it("returns a friendly reply when the LLM call fails", async () => {
    // An empty script makes the fake LLM throw on the first call (simulates an outage).
    const llm = makeFakeLlm([]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });
    expect(result.reply).toMatch(/couldn't reach the language model/i);
  });

  it("picks the reply from the LLM error taxonomy kind", async () => {
    const cases: Array<{ kind: "auth" | "rate_limit" | "server" | "network"; match: RegExp }> = [
      { kind: "auth", match: /credentials problem/i },
      { kind: "rate_limit", match: /busy right now/i },
      { kind: "server", match: /couldn't reach the language model/i },
      { kind: "network", match: /couldn't reach the language model/i },
    ];
    for (const { kind, match } of cases) {
      const llm = makeFakeLlm([new LlmProviderError(kind, `simulated ${kind}`)]);
      const deps = makeAgentDeps(llm);
      const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
      const result = await runAgent(deps, {
        userId,
        isOwner,
        conversationId,
        triggerMessageId: "m1",
      });
      expect(result.reply, `kind=${kind}`).toMatch(match);
    }
  });

  it("never returns an empty reply when the model gives no content", async () => {
    const llm = makeFakeLlm([
      { content: null, toolCalls: [], finishReason: "stop", usage: { tokensIn: 5, tokensOut: 0 } },
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });
    expect(result.reply.trim().length).toBeGreaterThan(0);
  });

  it("runs a tool call then returns the final answer", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "write", content: "likes hiking" }),
      textResult("Got it — I'll remember that."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toMatch(/remember/i);
    // The memory was written.
    const memories = await deps.memories.listActive(userId);
    expect(memories.map((m) => m.content)).toContain("likes hiking");
    expect(llm.calls).toHaveLength(2);
    // The tool-requesting turn is persisted structurally: an assistant row carrying the
    // tool_calls JSON (no flattened "Used tool: …" summary), and a tool row linked to it
    // by tool_call_id. buildContext can now replay this exchange across turns.
    const stored = await deps.messages.listByConversation(conversationId);
    const assistantCall = stored.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistantCall?.tool_calls?.[0]?.name).toBe("memory");
    expect(assistantCall?.tool_calls?.[0]?.arguments).toContain("likes hiking");
    const toolResult = stored.find((m) => m.role === "tool");
    expect(toolResult?.tool_call_id).toBe(assistantCall?.tool_calls?.[0]?.id);
    expect(toolResult?.tool_name).toBe("memory");
    // No "Used tool: …" text is written anywhere anymore.
    expect(stored.some((m) => m.content?.includes("Used tool"))).toBe(false);
  });

  it("flags a reply that was cut off by the output token limit", async () => {
    const llm = makeFakeLlm([textResult("Here is the start of a very long ans", 1024, "length")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toContain("Here is the start of a very long ans");
    expect(result.reply).toMatch(/cut off/i);
  });

  it("does not execute a truncated tool call; feeds back why instead", async () => {
    const llm = makeFakeLlm([
      // A `length` stop mid-tool-call: the arguments JSON is incomplete.
      truncatedToolCallResult("memory", '{"action":"write","content":"likes hi'),
      textResult("Let me keep that brief: noted."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Let me keep that brief: noted.");
    // The truncated call never executed — nothing was written.
    expect(await deps.memories.listActive(userId)).toHaveLength(0);
    // The model was told the real cause (not a generic JSON parse error).
    const feedback = llm.calls[1]?.messages.find((m) => m.role === "tool");
    expect(feedback?.content).toMatch(/cut off by the output token limit/i);
    expect(feedback?.tool_call_id).toBe("call-1");
  });

  it("forces a plain-text answer when the model repeats a tool call", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }),
      toolCallResult("memory", { action: "list" }), // identical repeat → stuck
      textResult("Here's what I found."), // the tools-disabled forced answer
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Here's what I found.");
    expect(llm.calls).toHaveLength(3);
    // The final forced call has no tools, so the model must answer.
    expect(llm.calls.at(-1)?.tools).toBeUndefined();
  });

  it("forces an answer after the iteration cap with distinct tool calls", async () => {
    const llm = makeFakeLlm([
      ...Array.from({ length: 5 }, (_, n) =>
        toolCallResult("memory", { action: "search", term: `t${n}` }),
      ),
      textResult("Final synthesized answer."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Final synthesized answer.");
    expect(llm.calls).toHaveLength(6); // 5 capped iterations + 1 forced answer
  });

  it("degrades to the cheap model and adds an over-budget note when over the ceiling", async () => {
    const llm = makeFakeLlm([textResult("Brief answer.")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "x",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 150,
    });

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toMatch(/over this month's budget/i);
    expect(llm.calls[0]?.model).toBe("llama-3.1-8b-instruct"); // cheap seed
    expect(llm.calls[0]?.maxTokens).toBeLessThanOrEqual(256);
  });

  it("gates an over-threshold turn instead of running it", async () => {
    // Force a large input estimate so the estimate clears the threshold.
    const llm = makeFakeLlm([textResult("should not run yet")], { fixedInputTokens: 1_000_000 });
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.pendingApprovalId).toBeTruthy();
    expect(result.reply).toMatch(/approve/i);
    expect(llm.calls).toHaveLength(0); // not run yet
    expect(await deps.llmUsage.monthToDateCents(userId)).toBe(0); // nothing metered
    const row = await deps.pendingApprovals.findById(result.pendingApprovalId!);
    expect(row?.status).toBe("pending");
  });

  it("resumeApprovedAgent runs the gated turn with the gate bypassed", async () => {
    const llm = makeFakeLlm([textResult("here's the answer")], { fixedInputTokens: 1_000_000 });
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const gated = await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });
    const resumed = await resumeApprovedAgent(deps, gated.pendingApprovalId!);

    expect(resumed?.reply).toBe("here's the answer");
    expect(llm.calls).toHaveLength(1); // ran exactly once, on resume
  });
});
