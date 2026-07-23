import { messages } from "../i18n/index.js";
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
      reply: messages(plan.language).approval.prompt(
        Math.ceil(plan.estimatedCostCents),
        plan.approvalThresholdCents,
      ),
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
  });

  const reply = plan.overBudgetNote ? `${plan.overBudgetNote}\n\n${loop.reply}` : loop.reply;
  return { reply, conversationId: input.conversationId, alertPct: loop.alertPct };
}

/**
 * Run a turn the user just approved via the gate. Rebuilds context from the stored
 * conversation (the trigger message is already persisted) and runs the agent with the
 * gate bypassed. Returns null if the approval row is gone or its user can't be found.
 */
export async function resumeApprovedAgent(
  deps: AgentDeps,
  approvalId: string,
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
  });
}
