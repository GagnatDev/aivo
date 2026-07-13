import { logger } from "../logger.js";
import { ConfigError } from "../llm/errors.js";
import type { ChatMessage, ToolSchema } from "../llm/provider.js";
import { computeCostCents, preCallCheck, type Tier } from "./budget.js";
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

// The approval gate records pending approvals under this task type (kept in step with
// the tool loop's metering task type in toolLoop.ts).
const TASK_TYPE = "chat";
// When over the monthly ceiling we still answer, but keep it short.
const OVER_BUDGET_MAX_TOKENS = 256;

export interface RunAgentInput {
  userId: string;
  isOwner: boolean;
  conversationId: string;
  /** Discord id of the message that triggered this turn (for the approval gate). */
  triggerMessageId: string;
  /** Skip the approval gate — set when resuming an already-approved turn. */
  bypassApprovalGate?: boolean;
}

/** A turn that cleared pre-flight and is ready to run through the tool loop. */
export interface PreparedTurn {
  kind: "prepared";
  ctx: ToolContext;
  registry: AgentTool[];
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  maxTokens: number;
  /** Prepended to the final reply when the turn ran degraded over the budget ceiling. */
  overBudgetNote?: string;
}

/** A turn whose estimated cost exceeds the user's approval threshold; must be gated. */
export interface GatedTurn {
  kind: "gated";
  estimatedCostCents: number;
  approvalThresholdCents: number;
}

/** A turn that can't run and short-circuits to a fixed reply (e.g. no model configured). */
export interface EarlyReply {
  kind: "reply";
  reply: string;
}

export type TurnPlan = PreparedTurn | GatedTurn | EarlyReply;

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

/**
 * Resolve the model id for a tier, falling back to the other tier if unconfigured.
 * Throws {@link ConfigError} when neither tier has a model — the config boundary is
 * where that fact is known, so it's raised as a typed error rather than a bare null.
 * Exported for the digest pipeline, which resolves its own stage tiers.
 */
export async function resolveModel(deps: AgentDeps, tier: Tier): Promise<string> {
  const row = await deps.modelPricing.getByTier(tier);
  if (row) return row.model_id;
  const fallbackTier = tier === "cheap" ? "premium" : "cheap";
  const fallback = await deps.modelPricing.getByTier(fallbackTier);
  if (fallback) {
    // No model fills the requested slot — running on the wrong tier degrades quality
    // silently, so make it loud. Usually means the slot was never (re)assigned.
    logger.warn(
      { requestedTier: tier, fallbackModel: fallback.model_id, fallbackTier },
      "no model configured for requested tier; falling back",
    );
    return fallback.model_id;
  }
  throw new ConfigError("no model configured for any tier");
}

/**
 * The turn policy, extracted from the loop as a value-returning function: tier
 * resolution → budget pre-check → model resolution → context build → tool gating →
 * approval-gate decision. It performs no LLM calls and drives no loop, so its
 * boundaries (tier coercion, token capping, whether the approval gate fires) can be
 * asserted directly without running a whole turn. The returned {@link TurnPlan} tells
 * `runAgent` exactly what to do next: run the loop, gate, or reply immediately.
 */
export async function prepareTurn(deps: AgentDeps, input: RunAgentInput): Promise<TurnPlan> {
  const settings = await deps.settings.getOrCreate(input.userId);
  const requestedTier = resolveTier(settings.model_tier);
  const decision = await preCallCheck(deps, input.userId, requestedTier);

  let model: string;
  try {
    model = await resolveModel(deps, decision.coercedTier);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error({ err }, "no model configured");
      return {
        kind: "reply",
        reply: "I have no model configured yet — ask the owner to set up the model/pricing config.",
      };
    }
    throw err;
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
  // threshold, don't run it — signal the caller to post a confirmation prompt and wait.
  // The estimate is conservative (heuristic input tokens + worst-case output = maxTokens),
  // so it over-asks rather than under-asks. Resumed turns bypass this (approval is the
  // decision).
  if (!input.bypassApprovalGate && decision.approvalThresholdCents != null) {
    const estimatedCost = await estimateTurnCost(deps, model, messages, tools, maxTokens);
    if (estimatedCost > decision.approvalThresholdCents) {
      return {
        kind: "gated",
        estimatedCostCents: estimatedCost,
        approvalThresholdCents: decision.approvalThresholdCents,
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
    "agent turn prepared",
  );

  return {
    kind: "prepared",
    ctx,
    registry,
    model,
    messages,
    tools,
    maxTokens,
    overBudgetNote: decision.overBudgetNote,
  };
}

export { TASK_TYPE };
