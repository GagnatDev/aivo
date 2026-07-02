import { logger } from "../logger.js";
import type { ChatMessage, ToolSchema } from "../llm/provider.js";
import { computeCostCents, preCallCheck, recordUsageAndAlert, type Tier } from "./budget.js";
import { buildContext } from "./context.js";
import type { AgentDeps } from "./deps.js";
import {
  buildToolRegistry,
  resolveTier,
  selectToolSchemas,
  type AgentTool,
  type ToolContext,
} from "./tools/index.js";

// How many recent user/assistant messages to scan when deciding which tools to
// advertise — enough to catch an immediate follow-up that omits the keyword.
const TOOL_GATING_LOOKBACK = 4;

const TASK_TYPE = "chat";
// When over the monthly ceiling we still answer, but keep it short.
const OVER_BUDGET_MAX_TOKENS = 256;
// Discord rejects empty message bodies, so never return "" to the caller.
const EMPTY_REPLY_FALLBACK = "I don't have anything to add to that.";
// Shown when the LLM provider call fails (auth, rate limit, outage, …) so the user
// gets an answer instead of silence.
const LLM_ERROR_FALLBACK =
  "Sorry — I couldn't reach the language model just now. Please try again in a moment.";
// Last-resort reply when even the tools-disabled final answer yields nothing.
const STUCK_FALLBACK = "I got a bit tangled working through that — can you rephrase?";

export interface RunAgentInput {
  userId: string;
  isOwner: boolean;
  conversationId: string;
  /** Discord id of the message that triggered this turn (for the approval gate). */
  triggerMessageId: string;
  /** Skip the approval gate — set when resuming an already-approved turn. */
  bypassApprovalGate?: boolean;
}

export interface AgentResult {
  reply: string;
  conversationId: string;
  /** Set when the turn was gated pending the user's approval (see approval gate). */
  pendingApprovalId?: string;
  /** Set when a budget alert threshold was newly crossed this turn. */
  alertPct?: number;
}

/** Conservative pre-call cost estimate for the approval gate (in fractional cents). */
async function estimateTurnCost(
  deps: AgentDeps,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  maxTokens: number,
): Promise<number> {
  const pricing = await deps.modelPricing.getByModelId(model);
  if (!pricing) return 0;
  const tokensIn = deps.llm.countTokens(messages, tools);
  return computeCostCents(
    {
      inputCostPerMtokCents: Number(pricing.input_cost_per_mtok_cents),
      outputCostPerMtokCents: Number(pricing.output_cost_per_mtok_cents),
    },
    { tokensIn, tokensOut: maxTokens },
  );
}

/** Resolve the model id for a tier, falling back to the other tier if unconfigured. */
async function resolveModel(deps: AgentDeps, tier: Tier): Promise<string | null> {
  const row = await deps.modelPricing.getByTier(tier);
  if (row) return row.model_id;
  const fallback = await deps.modelPricing.getByTier(tier === "cheap" ? "premium" : "cheap");
  if (fallback) {
    // No model holds the requested role — running on the wrong tier degrades quality
    // silently, so make it loud. Usually means a tier_role was never (re)assigned.
    logger.warn(
      { requestedTier: tier, fallbackModel: fallback.model_id, fallbackRole: fallback.tier_role },
      "no model configured for requested tier; falling back",
    );
    return fallback.model_id;
  }
  return null;
}

/**
 * The conversational agent. Builds context, applies the budget pre-check (degrading
 * the tier if needed), and runs the in-house tool-calling loop. The final user-facing
 * text is returned for the caller to send + persist with its Discord id; intermediate
 * assistant-with-tool-calls and tool rows are persisted in-loop for audit.
 */
export async function runAgent(deps: AgentDeps, input: RunAgentInput): Promise<AgentResult> {
  const settings = await deps.settings.getOrCreate(input.userId);
  const requestedTier = resolveTier(settings.model_tier);
  const decision = await preCallCheck(deps, input.userId, requestedTier);

  const model = await resolveModel(deps, decision.coercedTier);
  if (!model) {
    return {
      reply: "I have no model configured yet — ask the owner to set up the model/pricing config.",
      conversationId: input.conversationId,
    };
  }

  const registry = buildToolRegistry();
  const messages = await buildContext(deps, {
    userId: input.userId,
    conversationId: input.conversationId,
    settings,
    historyLimit: deps.config.contextMessageLimit,
    memoryLimit: deps.config.memoryInjectLimit,
  });

  // Advertise only the tools the recent conversation looks like it needs (the 4 schemas
  // are ~1.1k tokens, re-sent on every call). `memory` is always on; the management
  // tools are keyword-gated. The full registry still backs execution, so a tool the
  // model somehow calls without it being advertised is handled, not lost.
  const recentText = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-TOOL_GATING_LOOKBACK)
    .map((m) => m.content ?? "")
    .join("\n");
  const tools = selectToolSchemas(registry, recentText);

  const maxTokens = decision.overBudgetNote
    ? Math.min(deps.config.llmMaxOutputTokens, OVER_BUDGET_MAX_TOKENS)
    : deps.config.llmMaxOutputTokens;

  // Approval gate: if the estimated cost of this turn's first call exceeds the user's
  // threshold, don't run it — post a confirmation prompt and wait. The estimate is
  // conservative (heuristic input tokens + worst-case output = maxTokens), so it
  // over-asks rather than under-asks. Resumed turns bypass this (approval is the
  // decision).
  if (!input.bypassApprovalGate && decision.approvalThresholdCents != null) {
    const estimatedCost = await estimateTurnCost(deps, model, messages, tools, maxTokens);
    if (estimatedCost > decision.approvalThresholdCents) {
      const approval = await deps.pendingApprovals.create({
        userId: input.userId,
        conversationId: input.conversationId,
        triggerMessageId: input.triggerMessageId,
        estimatedCostCents: estimatedCost,
        taskType: TASK_TYPE,
      });
      return {
        // Round the displayed estimate up so it never reads as equal to (or below)
        // the threshold it just exceeded.
        reply:
          `This looks like it'll cost about ${Math.ceil(estimatedCost)}¢, over your ` +
          `${decision.approvalThresholdCents}¢ approval threshold. Approve to go ahead?`,
        conversationId: input.conversationId,
        pendingApprovalId: approval.id,
      };
    }
  }

  const ctx: ToolContext = {
    deps,
    userId: input.userId,
    isOwner: input.isOwner,
    conversationId: input.conversationId,
  };

  logger.debug(
    {
      userId: input.userId,
      model,
      requestedTier,
      coercedTier: decision.coercedTier,
      overBudget: Boolean(decision.overBudgetNote),
      maxTokens,
      historyMessages: messages.length,
      tools: tools.map((t) => t.name),
    },
    "agent turn starting",
  );

  const loop = await runToolLoop(deps, ctx, registry, { model, messages, tools, maxTokens });

  const reply = decision.overBudgetNote
    ? `${decision.overBudgetNote}\n\n${loop.reply}`
    : loop.reply;
  return { reply, conversationId: input.conversationId, alertPct: loop.alertPct };
}

interface LoopParams {
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  maxTokens: number;
}

interface LoopResult {
  reply: string;
  alertPct?: number;
}

/**
 * The in-house tool-calling loop. Each model round-trip is metered; tool calls are
 * executed and their results fed back until the model returns a final text answer or
 * the iteration cap is hit (runaway backstop). Exported so the approval-gate resume
 * path can reuse it.
 */
export async function runToolLoop(
  deps: AgentDeps,
  ctx: ToolContext,
  registry: AgentTool[],
  params: LoopParams,
): Promise<LoopResult> {
  const messages = params.messages;
  let alertPct: number | undefined;
  // Signatures (name+args) of tool calls already executed this turn — used to detect
  // a model stuck re-issuing the same calls (a common open-model failure mode).
  const executed = new Set<string>();

  for (let i = 0; i < deps.config.agentMaxToolIterations; i++) {
    let result;
    try {
      result = await deps.llm.chat({
        model: params.model,
        messages,
        tools: params.tools,
        maxTokens: params.maxTokens,
      });
    } catch (err) {
      // Provider failure (auth/403, rate limit, outage). Surface a friendly reply
      // rather than letting the turn throw and leave the user with no response.
      logger.error(err, "llm chat call failed");
      return { reply: LLM_ERROR_FALLBACK, alertPct };
    }

    const record = await recordUsageAndAlert(deps, ctx.userId, TASK_TYPE, params.model, result.usage);
    if (record.alertPct) alertPct = Math.max(alertPct ?? 0, record.alertPct);

    logger.debug(
      {
        userId: ctx.userId,
        iteration: i,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        toolCalls: result.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
        contentPreview: preview(result.content),
      },
      "agent llm round-trip",
    );

    if (result.toolCalls.length === 0) {
      logger.debug({ userId: ctx.userId, iterations: i + 1 }, "agent final reply");
      return { reply: (result.content ?? "").trim() || EMPTY_REPLY_FALLBACK, alertPct };
    }

    // Persist + replay the assistant message that requested the tools.
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
    await deps.messages.insert({
      conversationId: ctx.conversationId,
      role: "assistant",
      content: result.content,
      discordMessageId: null,
    });

    let allRepeats = true;
    for (const call of result.toolCalls) {
      const signature = `${call.name}:${call.arguments}`;
      if (!executed.has(signature)) allRepeats = false;
      executed.add(signature);
      const toolResult = await executeToolCall(registry, call.name, call.arguments, ctx);
      logger.debug(
        { userId: ctx.userId, tool: call.name, arguments: call.arguments, resultPreview: preview(toolResult) },
        "agent tool executed",
      );
      await deps.messages.insert({
        conversationId: ctx.conversationId,
        role: "tool",
        content: toolResult,
        discordMessageId: null,
      });
      messages.push({ role: "tool", content: toolResult, tool_call_id: call.id, name: call.name });
    }

    // The model re-issued only tool calls it had already made this turn — it's stuck.
    // Stop looping and force a plain-text answer from what it already has.
    if (allRepeats) {
      logger.warn({ userId: ctx.userId, model: params.model, iteration: i }, "agent repeated tool calls; forcing answer");
      return forceFinalAnswer(deps, ctx, params, messages, alertPct);
    }
  }

  logger.warn(
    { userId: ctx.userId, model: params.model, iterations: deps.config.agentMaxToolIterations },
    "agent hit tool-iteration cap; forcing answer",
  );
  return forceFinalAnswer(deps, ctx, params, messages, alertPct);
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

/**
 * Make one final completion with tools disabled so the model must answer in plain
 * text from the context it already has. Used when the loop is stuck (repeated tool
 * calls) or hit the iteration cap, turning a dead-end into a useful reply. The nudge
 * is not persisted; the resulting text is returned for the caller to send + record.
 */
async function forceFinalAnswer(
  deps: AgentDeps,
  ctx: ToolContext,
  params: LoopParams,
  messages: ChatMessage[],
  alertPct: number | undefined,
): Promise<LoopResult> {
  const nudged: ChatMessage[] = [
    ...messages,
    {
      role: "system",
      content:
        "Answer the user now in plain text, using the information you already have. " +
        "Do not call any tools.",
    },
  ];
  try {
    const result = await deps.llm.chat({ model: params.model, messages: nudged, maxTokens: params.maxTokens });
    const record = await recordUsageAndAlert(deps, ctx.userId, TASK_TYPE, params.model, result.usage);
    const nextAlert = record.alertPct ? Math.max(alertPct ?? 0, record.alertPct) : alertPct;
    const text = (result.content ?? "").trim();
    if (text) return { reply: text, alertPct: nextAlert };
    return { reply: STUCK_FALLBACK, alertPct: nextAlert };
  } catch (err) {
    logger.error(err, "forced final answer failed");
    return { reply: STUCK_FALLBACK, alertPct };
  }
}

/** Truncate a possibly-null string for log lines. */
function preview(text: string | null, max = 200): string {
  if (!text) return "(none)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function executeToolCall(
  registry: AgentTool[],
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = registry.find((t) => t.schema.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return "Could not parse tool arguments as JSON.";
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    logger.error(err, `tool ${name} failed`);
    return `The ${name} tool failed to run.`;
  }
}
