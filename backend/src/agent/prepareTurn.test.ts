import { describe, expect, it } from "vitest";
import { prepareTurn } from "./prepareTurn.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

// prepareTurn is the turn policy split out of the loop: it returns a plan without
// making any LLM call, so tier coercion, token capping, and the approval-gate boundary
// can be asserted directly instead of by running a whole turn.
describe("prepareTurn", () => {
  it("prepares a normal turn on the premium tier with full token budget", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);

    const plan = await prepareTurn(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(plan.kind).toBe("prepared");
    if (plan.kind !== "prepared") throw new Error("expected prepared");
    expect(plan.model).toBe("llama-3.3-70b-instruct"); // premium seed
    expect(plan.maxTokens).toBe(deps.config.llmMaxOutputTokens);
    expect(plan.overBudgetNote).toBeUndefined();
    expect(plan.tools.some((t) => t.name === "memory")).toBe(true); // memory is always on
  });

  it("coerces to the cheap tier and caps tokens when over the ceiling", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
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

    const plan = await prepareTurn(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(plan.kind).toBe("prepared");
    if (plan.kind !== "prepared") throw new Error("expected prepared");
    expect(plan.model).toBe("llama-3.1-8b-instruct"); // cheap seed
    expect(plan.maxTokens).toBeLessThanOrEqual(256);
    expect(plan.overBudgetNote).toMatch(/over this month's budget/i);
  });

  it("gates a turn whose estimate exceeds the threshold, with no side effects", async () => {
    // Force a large input estimate so the estimate clears the threshold.
    const llm = makeFakeLlm([textResult("should not run")], { fixedInputTokens: 1_000_000 });
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const plan = await prepareTurn(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
    });

    expect(plan.kind).toBe("gated");
    if (plan.kind !== "gated") throw new Error("expected gated");
    expect(plan.estimatedCostCents).toBeGreaterThan(plan.approvalThresholdCents);
    expect(plan.approvalThresholdCents).toBe(50);
    // prepareTurn only decides — it makes no LLM call and creates no approval row.
    expect(llm.calls).toHaveLength(0);
    expect(await deps.llmUsage.monthToDateCents(userId)).toBe(0);
  });

  it("prepares (does not gate) when the approval gate is bypassed", async () => {
    const llm = makeFakeLlm([], { fixedInputTokens: 1_000_000 });
    const deps = makeAgentDeps(llm);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.budgetConfig.update(userId, { approval_threshold_cents: 50 });

    const plan = await prepareTurn(deps, {
      userId,
      isOwner,
      conversationId,
      triggerMessageId: "m1",
      bypassApprovalGate: true,
    });

    expect(plan.kind).toBe("prepared");
  });
});
