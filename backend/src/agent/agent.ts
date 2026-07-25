import type { AgentDeps } from "./deps.js";
import { prepareTurn, TASK_TYPE, type RunAgentInput } from "./prepareTurn.js";
import { runToolLoop } from "./toolLoop.js";

export type { RunAgentInput } from "./prepareTurn.js";

export interface AgentResult {
  reply: string;
  conversationId: string;
  /** Set when the turn was gated pending the user's approval (see approval gate). */
  pendingApprovalId?: string;
  /** Set when a budget alert threshold was newly crossed this turn. */
  alertPct?: number;
  /**
   * The turn was abandoned via `RunAgentInput.signal` (shutdown) instead of finishing.
   * The caller should drop the reply rather than send it.
   */
  aborted?: boolean;
}

/**
 * The conversational agent. Delegates the turn policy (tier resolution, budget
 * pre-check, context build, tool gating, approval-gate decision) to {@link prepareTurn}
 * and, when the turn is cleared to run, the in-house tool-calling loop to
 * {@link runToolLoop}. This function owns only the wiring between them and the
 * approval-gate side effect. The final user-facing text is returned for the caller to
 * send + persist with its Discord id; intermediate assistant-with-tool-calls and tool
 * rows are persisted in-loop for audit.
 */
export async function runAgent(deps: AgentDeps, input: RunAgentInput): Promise<AgentResult> {
  // Already cancelled before any work: skip the pre-flight reads too, not just the loop.
  if (input.signal?.aborted) {
    return { reply: "", conversationId: input.conversationId, aborted: true };
  }

  const plan = await prepareTurn(deps, input);

  if (plan.kind === "reply") {
    return { reply: plan.reply, conversationId: input.conversationId };
  }

  if (plan.kind === "gated") {
    const approval = await deps.pendingApprovals.create({
      userId: input.userId,
      conversationId: input.conversationId,
      triggerMessageId: input.triggerMessageId,
      estimatedCostCents: plan.estimatedCostCents,
      taskType: TASK_TYPE,
    });
    return {
      // Round the displayed estimate up so it never reads as equal to (or below)
      // the threshold it just exceeded.
      reply:
        `This looks like it'll cost about ${Math.ceil(plan.estimatedCostCents)}¢, over your ` +
        `${plan.approvalThresholdCents}¢ approval threshold. Approve to go ahead?`,
      conversationId: input.conversationId,
      pendingApprovalId: approval.id,
    };
  }

  const loop = await runToolLoop(deps, plan.ctx, plan.registry, {
    model: plan.model,
    messages: plan.messages,
    tools: plan.tools,
    maxTokens: plan.maxTokens,
    costCeilingCents: plan.costCeilingCents,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const reply = plan.overBudgetNote ? `${plan.overBudgetNote}\n\n${loop.reply}` : loop.reply;
  return {
    reply,
    conversationId: input.conversationId,
    alertPct: loop.alertPct,
    ...(loop.aborted ? { aborted: true } : {}),
  };
}

/**
 * Run a turn the user just approved via the gate. Rebuilds context from the stored
 * conversation (the trigger message is already persisted) and runs the agent with the
 * gate bypassed. Returns null if the approval row is gone or its user can't be found.
 */
export async function resumeApprovedAgent(
  deps: AgentDeps,
  approvalId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AgentResult | null> {
  const approval = await deps.pendingApprovals.findById(approvalId);
  if (!approval) return null;
  const user = await deps.users.findById(approval.user_id);
  if (!user) return null;
  return runAgent(deps, {
    userId: user.id,
    isOwner: user.is_owner,
    conversationId: approval.conversation_id,
    triggerMessageId: approval.trigger_message_id,
    bypassApprovalGate: true,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}
