import type { DegradationState, ModelTierRole } from "../db/schema.js";
import type { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import type { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import type { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import type { TokenUsage } from "../llm/provider.js";

/** The tier a request asks for / is coerced to. */
export type Tier = ModelTierRole;

/** The subset of deps the cost-control engine needs. */
export interface BudgetDeps {
  budgetConfig: BudgetConfigRepository;
  llmUsage: LlmUsageRepository;
  modelPricing: ModelPricingRepository;
}

// App-config thresholds for the behavior state machine (NOT stored per-row, per
// docs/data-model.md). The upper alert threshold doubles as the degrade trigger.
const CHEAP_MODELS_PCT = 80;

export interface BudgetSnapshot {
  monthlyCeilingCents: number;
  monthToDateCents: number;
  dailyCents: number;
  dailySoftCapCents: number | null;
  approvalThresholdCents: number | null;
  pctOfCeiling: number;
  state: DegradationState;
}

export interface PreCallDecision {
  /** Always true in v1 — chat is never blocked outright, only degraded. */
  allowed: boolean;
  /** The tier to actually use after applying degradation. */
  coercedTier: Tier;
  /** A short note to surface to the user when over the monthly ceiling. */
  overBudgetNote?: string;
  /** The per-request approval-gate threshold in whole cents, or null if disabled. */
  approvalThresholdCents: number | null;
}

/**
 * Cost of a single call in fractional cents. Prices are cents per 1,000,000 tokens.
 * cost = (tokensIn*input + tokensOut*output) / 1_000_000.
 */
export function computeCostCents(
  pricing: { inputCostPerMtokCents: number; outputCostPerMtokCents: number },
  usage: TokenUsage,
): number {
  return (
    (usage.tokensIn * pricing.inputCostPerMtokCents +
      usage.tokensOut * pricing.outputCostPerMtokCents) /
    1_000_000
  );
}

/** Pure threshold→state machine. Spend only grows within a month, so this is monotonic. */
export function deriveState(snap: {
  monthlyCeilingCents: number;
  monthToDateCents: number;
  dailyCents: number;
  dailySoftCapCents: number | null;
}): DegradationState {
  if (snap.monthlyCeilingCents > 0 && snap.monthToDateCents >= snap.monthlyCeilingCents) {
    return "over_ceiling";
  }
  if (snap.dailySoftCapCents != null && snap.dailyCents >= snap.dailySoftCapCents) {
    return "cheap_models";
  }
  const pct =
    snap.monthlyCeilingCents > 0
      ? (snap.monthToDateCents / snap.monthlyCeilingCents) * 100
      : 0;
  if (pct >= CHEAP_MODELS_PCT) return "cheap_models";
  // `proactive_paused` is in the enum for the digest slice but unreachable here:
  // there is no proactive work to pause yet.
  return "normal";
}

/** Read the budget config + derived spend and compute the current state. */
export async function loadBudgetSnapshot(
  deps: BudgetDeps,
  userId: string,
): Promise<BudgetSnapshot> {
  const config = await deps.budgetConfig.getOrCreate(userId);
  const [monthToDateCents, dailyCents] = await Promise.all([
    deps.llmUsage.monthToDateCents(userId),
    deps.llmUsage.todayCents(userId),
  ]);
  const pctOfCeiling =
    config.monthly_ceiling_cents > 0
      ? (monthToDateCents / config.monthly_ceiling_cents) * 100
      : 0;
  const state = deriveState({
    monthlyCeilingCents: config.monthly_ceiling_cents,
    monthToDateCents,
    dailyCents,
    dailySoftCapCents: config.daily_soft_cap_cents,
  });
  return {
    monthlyCeilingCents: config.monthly_ceiling_cents,
    monthToDateCents,
    dailyCents,
    dailySoftCapCents: config.daily_soft_cap_cents,
    approvalThresholdCents: config.approval_threshold_cents,
    pctOfCeiling,
    state,
  };
}

/**
 * Decide which tier to use before a call, persisting the derived degradation state.
 * Chat is never blocked outright (concept: "never goes fully dark") — at the monthly
 * ceiling it still answers, but on the cheap tier with a short over-budget note; past
 * the cheap-models threshold or the daily soft cap it silently drops to the cheap tier.
 */
export async function preCallCheck(
  deps: BudgetDeps,
  userId: string,
  requestedTier: Tier,
): Promise<PreCallDecision> {
  const snap = await loadBudgetSnapshot(deps, userId);
  await deps.budgetConfig.setDegradationState(userId, snap.state);

  if (snap.state === "over_ceiling") {
    return {
      allowed: true,
      coercedTier: "cheap",
      approvalThresholdCents: snap.approvalThresholdCents,
      overBudgetNote:
        "Heads up — you're over this month's budget, so I'm keeping this brief and on the cheap model.",
    };
  }
  if (snap.state === "cheap_models" || snap.state === "proactive_paused") {
    return { allowed: true, coercedTier: "cheap", approvalThresholdCents: snap.approvalThresholdCents };
  }
  return { allowed: true, coercedTier: requestedTier, approvalThresholdCents: snap.approvalThresholdCents };
}

/** The highest configured alert threshold the current pct has reached, or 0. */
function crossedThreshold(thresholds: number[], pct: number): number {
  const reached = thresholds.filter((t) => pct >= t);
  return reached.length ? Math.max(...reached) : 0;
}

export interface UsageRecord {
  /** Set when a new alert threshold (50/80/100%) was crossed this call. */
  alertPct?: number;
}

/**
 * Write the ledger row for a completed call and decide whether a budget alert should
 * fire. Cost is computed from the actual model's pricing and real token usage, so the
 * ledger is exact regardless of any pre-call estimate. An alert fires only when the
 * month-to-date percentage newly crosses up through a configured threshold; the
 * `last_alerted_pct` watermark debounces repeats and self-resets at month rollover
 * (spend drops, so the crossed threshold drops, and the watermark follows it down).
 */
export async function recordUsageAndAlert(
  deps: BudgetDeps,
  userId: string,
  taskType: string,
  model: string,
  usage: TokenUsage,
): Promise<UsageRecord> {
  const pricing = await deps.modelPricing.getByModelId(model);
  const costCents = pricing
    ? computeCostCents(
        {
          inputCostPerMtokCents: Number(pricing.input_cost_per_mtok_cents),
          outputCostPerMtokCents: Number(pricing.output_cost_per_mtok_cents),
        },
        usage,
      )
    : 0;

  await deps.llmUsage.insert({
    userId,
    taskType,
    model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costCents,
  });

  const config = await deps.budgetConfig.getOrCreate(userId);
  if (config.monthly_ceiling_cents <= 0) return {};
  const mtd = await deps.llmUsage.monthToDateCents(userId);
  const pct = (mtd / config.monthly_ceiling_cents) * 100;
  const crossed = crossedThreshold(config.alert_thresholds, pct);

  if (crossed > config.last_alerted_pct) {
    await deps.budgetConfig.recordAlert(userId, crossed);
    return { alertPct: crossed };
  }
  if (crossed < config.last_alerted_pct) {
    // Month rolled over (spend reset) — lower the watermark so future climbs re-fire.
    await deps.budgetConfig.recordAlert(userId, crossed);
  }
  return {};
}
