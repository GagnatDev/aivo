// Types mirroring the dashboard models API (backend routes/dashboard/models.ts)
// and the pure transforms the Models page runs on them.

import type { DegradationState, Money } from "./usage.js";

export type TierRole = "cheap" | "premium";

export type ModelCapability = "chat" | "audio" | "vision";

export interface ModelRow {
  modelId: string;
  tierRole: TierRole | null;
  capabilities: ModelCapability[];
  inputCentsPerMtok: number;
  outputCentsPerMtok: number;
  /** Cents per minute of audio for audio models; null otherwise. */
  audioCentsPerMin: number | null;
  currency: string;
}

export interface ModelsOverview {
  models: ModelRow[];
  tiers: { cheap: string | null; premium: string | null };
  tierPreference: string;
  requestedTier: TierRole;
  effectiveTier: TierRole;
  degradation: { state: DegradationState; description: string };
}

export interface ModelsUsage {
  since: string;
  models: Array<{ model: string; cost: Money; calls: number; tokensIn: number; tokensOut: number }>;
}

export interface ModelShare {
  model: string;
  cost: Money;
  calls: number;
  /** Fraction of total spend in the window, 0..1 (0 when there is no spend). */
  share: number;
  /** Palette slot by stable alphabetical identity — matches the Usage page's
   * group coloring so a model keeps its color across pages. */
  colorIndex: number;
}

/**
 * Per-model spend shares for the usage-share bars (M-4). Keeps the API's
 * spend-descending order for display; color follows alphabetical identity.
 */
export function buildShares(usage: ModelsUsage): ModelShare[] {
  const total = usage.models.reduce((sum, m) => sum + m.cost.cents, 0);
  const alphabetical = [...usage.models.map((m) => m.model)].sort((a, b) => a.localeCompare(b));
  return usage.models.map((m) => ({
    model: m.model,
    cost: m.cost,
    calls: m.calls,
    share: total > 0 ? m.cost.cents / total : 0,
    colorIndex: alphabetical.indexOf(m.model),
  }));
}

/** "20¢ / 90¢ per Mtok" — trim trailing zeros the numeric(12,4) column carries. */
export function formatPerMtok(cents: number): string {
  if (cents >= 100) return `€${Number((cents / 100).toFixed(4))}`;
  return `${Number(cents.toFixed(4))}¢`;
}
