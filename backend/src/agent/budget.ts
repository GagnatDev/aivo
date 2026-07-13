import type { DegradationState, ModelTierRole } from "../db/schema.enums.js";
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
// docs/data-model.md). The upper alert threshold doubles as the degrade trigger;
// proactive work (digests) pauses on the last stretch before the hard ceiling.
const CHEAP_MODELS_PCT = 80;
const PROACTIVE_PAUSED_PCT = 90;

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

/**
 * Cost of a transcription in fractional cents. Audio models are billed by audio length,
 * not tokens (whisper per second, voxtral per audio-token), so aivo prices them uniformly
 * per audio-minute and derives the cost from the clip's known duration.
 * cost = ratePerMinCents * durationSeconds / 60.
 */
export function computeAudioCostCents(ratePerMinCents: number, durationSeconds: number): number {
  return (ratePerMinCents * durationSeconds) / 60;
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
    snap.monthlyCeilingCents > 0 ? (snap.monthToDateCents / snap.monthlyCeilingCents) * 100 : 0;
  // Stage 2 of the concept's graceful degradation: on the last stretch before the hard
  // ceiling, proactive work (the digest) pauses while direct chat keeps answering
  // (on the cheap tier — preCallCheck coerces proactive_paused like cheap_models).
  if (pct >= PROACTIVE_PAUSED_PCT) return "proactive_paused";
  if (pct >= CHEAP_MODELS_PCT) return "cheap_models";
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
    config.monthly_ceiling_cents > 0 ? (monthToDateCents / config.monthly_ceiling_cents) * 100 : 0;
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
    return {
      allowed: true,
      coercedTier: "cheap",
      approvalThresholdCents: snap.approvalThresholdCents,
    };
  }
  return {
    allowed: true,
    coercedTier: requestedTier,
    approvalThresholdCents: snap.approvalThresholdCents,
  };
}

/** The highest configured alert threshold the current pct has reached, or 0. */
function crossedThreshold(thresholds: number[], pct: number): number {
  const reached = thresholds.filter((t) => pct >= t);
  return reached.length ? Math.max(...reached) : 0;
}

export interface UsageRecord {
  /** Set when a new alert threshold (50/80/100%) was crossed this call. */
  alertPct?: number;
  /** The exact fractional-cent cost written to the ledger for this call. */
  costCents: number;
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

  return { costCents, ...(await applyAlert(deps, userId)) };
}

/**
 * Meter a transcription call: an `stt` ledger row whose cost comes from the audio model's
 * per-minute rate and the clip's duration (token counts are 0 — audio isn't token-billed).
 * Because budget state is derived from the summed `cost_cents`, never tokens, the ledger
 * stays honest; the same alert bookkeeping as chat then runs.
 */
export async function recordTranscriptionUsage(
  deps: BudgetDeps,
  userId: string,
  model: string,
  durationSeconds: number,
): Promise<UsageRecord> {
  const pricing = await deps.modelPricing.getByModelId(model);
  const ratePerMin =
    pricing?.audio_cost_per_min_cents != null ? Number(pricing.audio_cost_per_min_cents) : 0;
  const costCents = computeAudioCostCents(ratePerMin, durationSeconds);

  await deps.llmUsage.insert({
    userId,
    taskType: "stt",
    model,
    tokensIn: 0,
    tokensOut: 0,
    costCents,
  });

  return { costCents, ...(await applyAlert(deps, userId)) };
}

/**
 * After a ledger row is written, decide whether a budget alert should fire. An alert
 * fires only when month-to-date spend newly crosses up through a configured threshold;
 * the `last_alerted_pct` watermark debounces repeats and self-resets at month rollover
 * (spend drops, the crossed threshold drops, the watermark follows it down). Shared by
 * the chat and transcription metering paths so both alert identically.
 */
async function applyAlert(deps: BudgetDeps, userId: string): Promise<{ alertPct?: number }> {
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
