import { describe, expect, it } from "vitest";
import { runAgent, resumeApprovedAgent } from "./agent.js";
import { LlmProviderError } from "../llm/errors.js";
import { makeFakeLlm, textResult, toolCallResult } from "../test/fakeLlm.js";
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
      { content: null, toolCalls: [], usage: { tokensIn: 5, tokensOut: 0 } },
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
    // A tool-role message was persisted, and two model round-trips were metered.
    const stored = await deps.messages.listByConversation(conversationId);
    expect(stored.some((m) => m.role === "tool")).toBe(true);
    expect(llm.calls).toHaveLength(2);
    // The tool-requesting assistant turn had no text of its own, so instead of a null
    // ("(no content recorded)") row the activity log gets a description of what it did.
    const toolTurn = stored.find((m) => m.role === "assistant" && m.content?.startsWith("Used "));
    expect(toolTurn?.content).toContain("memory");
    expect(toolTurn?.content).toContain("likes hiking");
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
