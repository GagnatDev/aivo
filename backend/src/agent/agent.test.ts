import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent, resumeApprovedAgent } from "./agent.js";
import { LlmProviderError } from "../llm/errors.js";
import type { LlmProvider } from "../llm/provider.js";
import { logger } from "../logger.js";
import {
  makeFakeLlm,
  textResult,
  toolCallResult,
  truncatedToolCallResult,
} from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

/**
 * A tool-call round-trip metering 1 Mtok of input: on the premium seed model
 * (90¢/Mtok) that's 90¢ of real ledger cost per round-trip — enough to trip the
 * in-flight cost ceiling without touching the pre-call gate's (small) estimate.
 */
function expensiveToolCall(term: string, id: string) {
  return {
    ...toolCallResult("memory", { action: "search", term }, id),
    usage: { tokensIn: 1_000_000, tokensOut: 0 },
  };
}

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
    expect(result.reply).toMatch(/kontakt med språkmodellen/i);
  });

  it("picks the reply from the LLM error taxonomy kind", async () => {
    const cases: Array<{ kind: "auth" | "rate_limit" | "server" | "network"; match: RegExp }> = [
      { kind: "auth", match: /legitimasjonsproblem/i },
      { kind: "rate_limit", match: /opptatt akkurat nå/i },
      { kind: "server", match: /kontakt med språkmodellen/i },
      { kind: "network", match: /kontakt med språkmodellen/i },
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
    expect(result.reply).toMatch(/kuttet av/i);
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

  it("truncates an oversized tool result with a notice telling the model to narrow", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }),
      textResult("You've got a lot saved — here's the gist."),
    ]);
    // A tight per-result cap so a handful of memories overflows it.
    const deps = makeAgentDeps(llm, { toolResultMaxTokens: 40 });
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    for (let i = 0; i < 20; i++) {
      await deps.memories.insert({
        userId,
        content: `a long remembered fact number ${i}`,
        pinned: false,
      });
    }

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    // The tool result fed back on the second call is capped and carries the notice.
    const toolMsg = llm.calls[1]?.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/truncated/i);
    expect(toolMsg?.content).toMatch(/narrow/i);
    // The persisted tool row matches what the model saw (bounded, faithful replay).
    const stored = await deps.messages.listByConversation(conversationId);
    const toolRow = stored.find((m) => m.role === "tool");
    expect(toolRow?.content).toMatch(/truncated/i);
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
    // The final forced call disables tools in-protocol — the definitions still travel
    // with the request (the history is full of tool traffic), but `tool_choice: "none"`
    // means the model must answer in text. Portable across OpenAI-compatible servers.
    const forced = llm.calls.at(-1);
    expect(forced?.toolChoice).toBe("none");
    expect(forced?.tools?.length).toBeGreaterThan(0);
    // The nudge rides as a `user` note, not a trailing `system` message (some chat
    // templates reject a system role after tool traffic).
    expect(forced?.messages.at(-1)?.role).toBe("user");
    expect(forced?.messages.at(-1)?.content).toMatch(/do not call any tools/i);
    expect(
      forced?.messages.some((m) => m.role === "system" && /plain text/i.test(m.content ?? "")),
    ).toBe(false);
  });

  it("lets a read repeat when a write changed what it returns", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }, "c1"),
      toolCallResult("memory", { action: "write", content: "likes hiking" }, "c2"),
      // Same call as the first, but the write changed the answer — a confirming re-read,
      // not a stuck model, so the loop keeps its tools and carries on.
      toolCallResult("memory", { action: "list" }, "c3"),
      textResult("You've got one thing saved."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("You've got one thing saved.");
    expect(llm.calls).toHaveLength(4); // no forced answer cut the turn short
    expect(llm.calls.at(-1)?.tools?.length).toBeGreaterThan(0); // tools still advertised
  });

  it("forces an answer when a repeated call returns the same result, however it is formatted", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }, "c1"),
      // Same call, different argument formatting — canonicalized, so still a repeat.
      {
        content: null,
        toolCalls: [{ id: "c2", name: "memory", arguments: '{ "action" :  "list" }' }],
        finishReason: "tool_calls" as const,
        usage: { tokensIn: 20, tokensOut: 5 },
      },
      textResult("Nothing saved yet."), // the tools-disabled forced answer
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Nothing saved yet.");
    expect(llm.calls).toHaveLength(3);
    expect(llm.calls.at(-1)?.toolChoice).toBe("none"); // forced call has tools disabled
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

    expect(result.reply).toMatch(/over månedens budsjett/i);
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
    expect(result.reply).toMatch(/[Gg]odkjenn/);
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

  it("stops the loop and forces an answer when the turn's actual cost hits the ceiling", async () => {
    const llm = makeFakeLlm([
      expensiveToolCall("first", "call-1"),
      expensiveToolCall("second", "call-2"),
      textResult("Here's what I have so far."), // the tools-disabled forced answer
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    // Threshold 50¢ → in-flight ceiling 150¢ (3× default). The pre-call estimate is
    // tiny so the gate passes, but two 90¢ round-trips put the actual cost at 180¢.
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toContain("Here's what I have so far.");
    expect(result.reply).toMatch(/ble dyr/i); // the early-stop note
    expect(llm.calls).toHaveLength(3); // 2 tool round-trips + 1 forced answer
    expect(llm.calls.at(-1)?.toolChoice).toBe("none"); // forced call has tools disabled
  });

  it("does not stop a cheap multi-step turn just because a threshold is set", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }),
      textResult("All done."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("All done."); // no early-stop note
    expect(llm.calls).toHaveLength(2);
  });
});

describe("turn cancellation", () => {
  /** A fake LLM that aborts `controller` as soon as it has served call number `after`. */
  function abortingLlm(script: Parameters<typeof makeFakeLlm>[0], controller: AbortController) {
    const base = makeFakeLlm(script);
    let served = 0;
    return {
      ...base,
      async chat(req: Parameters<typeof base.chat>[0]) {
        const result = await base.chat(req);
        served += 1;
        if (served === 1) controller.abort();
        return result;
      },
    };
  }

  it("runs nothing when the signal is already aborted", async () => {
    const llm = makeFakeLlm([textResult("should never run")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    const controller = new AbortController();
    controller.abort();

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(llm.calls).toHaveLength(0);
    expect(await deps.llmUsage.monthToDateCents(userId)).toBe(0);
  });

  it("abandons the turn mid-loop without executing the pending tool call", async () => {
    const controller = new AbortController();
    const llm = abortingLlm(
      [
        toolCallResult("memory", { action: "write", content: "likes hiking" }),
        textResult("should never run"),
      ],
      controller,
    );
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(llm.calls).toHaveLength(1); // no second round-trip
    expect(await deps.memories.listActive(userId)).toHaveLength(0); // tool never ran
  });

  it("leaves the persisted history replayable after an abort", async () => {
    const controller = new AbortController();
    const llm = abortingLlm(
      [toolCallResult("memory", { action: "list" }), textResult("should never run")],
      controller,
    );
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
      signal: controller.signal,
    });

    // Every tool call the model made has an answer on record — an assistant row with
    // unanswered tool_calls would make the next turn's message list invalid.
    const stored = await deps.messages.listByConversation(conversationId);
    const assistantCall = stored.find((m) => m.role === "assistant" && m.tool_calls?.length);
    const answer = stored.find((m) => m.role === "tool");
    expect(answer?.tool_call_id).toBe(assistantCall?.tool_calls?.[0]?.id);
    expect(answer?.content).toMatch(/cancelled/i);
  });

  it("reports an aborted provider call as an abort, not a provider failure", async () => {
    // The provider throws because we cancelled it (as the real SDK does on abort).
    const controller = new AbortController();
    const llm: LlmProvider = {
      ...makeFakeLlm([]),
      async chat() {
        controller.abort();
        throw new LlmProviderError("aborted", "LLM call aborted");
      },
    };
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.reply).not.toMatch(/couldn't reach the language model/i);
  });
});

describe("turn observability record", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stub the turn's child logger so the info-level record can be asserted. */
  function captureTurnLog() {
    const info = vi.fn();
    const child = vi.spyOn(logger, "child").mockReturnValue({
      info,
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ReturnType<typeof logger.child>);
    /** The single "agent turn completed" payload. */
    const record = (): Record<string, unknown> => {
      const completed = info.mock.calls.filter(([, msg]) => msg === "agent turn completed");
      expect(completed).toHaveLength(1);
      return completed[0]?.[0] as Record<string, unknown>;
    };
    /** The turn id bound onto every line of the turn (and onto its persisted row). */
    const turnId = (): string => (child.mock.calls[0]?.[0] as { turnId: string }).turnId;
    return { child, record, turnId };
  }

  it("emits one info-level record per turn with totals and a correlating turn id", async () => {
    const { child, record } = captureTurnLog();
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "write", content: "likes hiking" }),
      textResult("Got it."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    // The child logger binds the turn id + ids to every line of the turn.
    expect(child).toHaveBeenCalledWith({
      turnId: expect.any(String),
      userId,
      conversationId,
    });
    expect(record()).toMatchObject({
      outcome: "final_answer",
      iterations: 2,
      toolsCalled: ["memory"],
      toolErrors: 0,
      tokensIn: 40, // 20 per scripted round-trip
      tokensOut: 15, // 5 (tool call) + 10 (final text)
      finishReasons: ["tool_calls", "stop"],
      latencyMs: expect.any(Number),
    });
    expect(record().costCents).toBeGreaterThan(0); // seeded pricing → real cost
  });

  it("counts a failed tool call in the record", async () => {
    const { record } = captureTurnLog();
    const llm = makeFakeLlm([toolCallResult("no_such_tool", {}), textResult("Sorry.")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    expect(record()).toMatchObject({ toolsCalled: ["no_such_tool"], toolErrors: 1 });
  });

  it("records a forced answer, folding the forced round-trip into the totals", async () => {
    const { record } = captureTurnLog();
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "list" }),
      toolCallResult("memory", { action: "list" }), // identical repeat → stuck
      textResult("Here's what I found."), // the tools-disabled forced answer
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    expect(record()).toMatchObject({
      outcome: "forced_answer",
      iterations: 2,
      toolsCalled: ["memory", "memory"],
      tokensIn: 60, // all three round-trips metered, forced one included
      finishReasons: ["tool_calls", "tool_calls", "stop"],
    });
  });

  it("records a cost-ceiling stop as its own outcome, folding the forced round-trip in", async () => {
    const { record } = captureTurnLog();
    const llm = makeFakeLlm([
      expensiveToolCall("first", "call-1"),
      expensiveToolCall("second", "call-2"),
      textResult("Here's what I have so far."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    expect(record()).toMatchObject({
      outcome: "cost_ceiling",
      iterations: 2,
      toolsCalled: ["memory", "memory"],
      finishReasons: ["tool_calls", "tool_calls", "stop"],
    });
    expect(record().costCents as number).toBeGreaterThanOrEqual(150); // past the ceiling
  });

  it("records a provider failure as its own outcome", async () => {
    const { record } = captureTurnLog();
    const llm = makeFakeLlm([new LlmProviderError("server", "simulated outage")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    expect(record()).toMatchObject({ outcome: "provider_error", iterations: 0, tokensIn: 0 });
  });

  it("persists the same record for the dashboard, correlated by the logged turn id", async () => {
    const { record, turnId } = captureTurnLog();
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "write", content: "likes hiking" }),
      textResult("Got it."),
    ]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    const rows = await deps.turnSummaries.listForWindow(conversationId, { since: new Date(0) });
    expect(rows).toHaveLength(1);
    const logged = record();
    expect(rows[0]).toMatchObject({
      user_id: userId,
      conversation_id: conversationId,
      outcome: "final_answer",
      iterations: 2,
      tools_called: ["memory"],
      tool_errors: 0,
      tokens_in: 40,
      tokens_out: 15,
      finish_reasons: ["tool_calls", "stop"],
      latency_ms: logged.latencyMs,
    });
    // Stored at the ledger's precision (numeric(12,4)), so a sub-cent turn rounds.
    expect(rows[0]?.cost_cents).toBeCloseTo(logged.costCents as number, 4);
    // Same id on the row and on every log line of the turn, so the two correlate.
    expect(rows[0]?.turn_id).toBe(turnId());
  });

  it("persists a row for a turn that ended on the iteration cap", async () => {
    const llm = makeFakeLlm([
      toolCallResult("memory", { action: "search", term: "a" }, "c1"),
      toolCallResult("memory", { action: "search", term: "b" }, "c2"),
      textResult("Best I can do."),
    ]);
    const deps = makeAgentDeps(llm, { agentMaxToolIterations: 2 });
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    await runAgent(deps, { userId, isOwner, conversationId, triggerMessageId: "m1" });

    const rows = await deps.turnSummaries.listForWindow(conversationId, { since: new Date(0) });
    expect(rows.map((r) => r.outcome)).toEqual(["iteration_cap"]);
    expect(rows[0]?.iterations).toBe(2);
  });

  it("still answers the user when the record cannot be persisted", async () => {
    const llm = makeFakeLlm([textResult("Noted.")]);
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    vi.spyOn(deps.turnSummaries, "insert").mockRejectedValue(new Error("db down"));

    const result = await runAgent(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(result.reply).toBe("Noted.");
  });
});
