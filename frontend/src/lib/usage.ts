// Types mirroring the dashboard usage API (backend routes/dashboard/usage.ts)
// and the pure chart-data transforms the Usage page runs on them.

export interface Money {
  cents: number;
  formatted: string;
}

export type DegradationState = "normal" | "cheap_models" | "proactive_paused" | "over_ceiling";

export interface UsageSummary {
  today: Money;
  monthToDate: Money;
  monthlyCeiling: Money | null;
  dailySoftCap: Money | null;
  approvalThreshold: Money | null;
  alertThresholds: number[];
  pctOfCeiling: number;
  degradation: { state: DegradationState; description: string };
}

export interface SeriesBucket {
  day: string;
  group: string | null;
  cost: Money;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Prompt-cache hits among tokensIn (a subset, not extra). */
  tokensCached: number;
}

export interface UsageSeries {
  from: string;
  to: string;
  groupBy: "model" | "task_type" | null;
  buckets: SeriesBucket[];
}

export interface UsageDrivers {
  since: string;
  drivers: Array<{ model: string; taskType: string; cost: Money; calls: number }>;
}

/** Every UTC calendar day from `from` up to and including `to`'s day. */
export function listUtcDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= endDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export interface BurnDownPoint {
  day: string;
  cumulativeCents: number;
}

/**
 * Cumulative spend per day for the MTD burn-down (U-1). Days without usage carry
 * the running total forward so the line is continuous.
 */
export function buildBurnDown(buckets: SeriesBucket[], days: string[]): BurnDownPoint[] {
  const perDay = new Map<string, number>();
  for (const b of buckets) {
    perDay.set(b.day, (perDay.get(b.day) ?? 0) + b.cost.cents);
  }
  let running = 0;
  return days.map((day) => {
    running += perDay.get(day) ?? 0;
    return { day, cumulativeCents: running };
  });
}

/** A day row for stacked charts: `day` plus one cents value per group key. */
export type PivotRow = { day: string } & Record<string, number | string>;

export interface PivotedSeries {
  rows: PivotRow[];
  /** Stable identity order (alphabetical), so colors follow entities, not ranks. */
  groups: string[];
}

/** Beyond this many groups the smallest fold into "Other" (fixed-order palette). */
export const MAX_GROUPS = 8;
export const OTHER_GROUP = "Other";

/**
 * Pivot day buckets into stacked-chart rows (U-2): one row per calendar day, one
 * keyed column per group, zero-filled. Groups keep alphabetical order so a range
 * change never repaints a surviving series; overflow folds into "Other".
 */
export function pivotBuckets(buckets: SeriesBucket[], days: string[]): PivotedSeries {
  const totals = new Map<string, number>();
  for (const b of buckets) {
    const key = b.group ?? "total";
    totals.set(key, (totals.get(key) ?? 0) + b.cost.cents);
  }
  let groups = [...totals.keys()].sort((a, b) => a.localeCompare(b));
  let folded: Set<string> | null = null;
  if (groups.length > MAX_GROUPS) {
    const bySpend = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    folded = new Set(bySpend.slice(MAX_GROUPS - 1).map(([key]) => key));
    groups = [...groups.filter((g) => !folded!.has(g)), OTHER_GROUP];
  }

  const rows = days.map((day) => {
    const row: PivotRow = { day };
    for (const g of groups) row[g] = 0;
    return row;
  });
  const rowByDay = new Map(rows.map((r) => [r.day, r]));
  for (const b of buckets) {
    const row = rowByDay.get(b.day);
    if (!row) continue;
    let key = b.group ?? "total";
    if (folded?.has(key)) key = OTHER_GROUP;
    row[key] = (row[key] as number) + b.cost.cents;
  }
  return { rows, groups };
}

export interface TokenMixPoint {
  day: string;
  tokensIn: number;
  tokensOut: number;
  /** The share of tokensIn served from the provider's prompt cache. */
  tokensCached: number;
}

/** Daily tokens in vs out, plus cached input (U-4), zero-filled across the range. */
export function buildTokenMix(buckets: SeriesBucket[], days: string[]): TokenMixPoint[] {
  const byDay = new Map<string, TokenMixPoint>(
    days.map((day) => [day, { day, tokensIn: 0, tokensOut: 0, tokensCached: 0 }]),
  );
  for (const b of buckets) {
    const point = byDay.get(b.day);
    if (!point) continue;
    point.tokensIn += b.tokensIn;
    point.tokensOut += b.tokensOut;
    point.tokensCached += b.tokensCached;
  }
  return [...byDay.values()];
}

/** Fraction of input tokens served from the prompt cache over the range; null with no input. */
export function cacheHitRatio(points: TokenMixPoint[]): number | null {
  let tokensIn = 0;
  let tokensCached = 0;
  for (const p of points) {
    tokensIn += p.tokensIn;
    tokensCached += p.tokensCached;
  }
  return tokensIn > 0 ? tokensCached / tokensIn : null;
}

export type UsageRange = "7d" | "30d" | "mtd";

/** The [from, to) window a range button maps to. UTC, matching the API's buckets. */
export function rangeToWindow(range: UsageRange, now: Date): { from: Date; to: Date } {
  if (range === "mtd") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
  }
  const days = range === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

/** Compact money for axis ticks: cents under a euro, euros above. */
export function formatCentsTick(cents: number): string {
  if (Math.abs(cents) >= 100) return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 1)}`;
  return `${Number(cents.toFixed(2))}¢`;
}

/** Short "Jun 5" tick label for a YYYY-MM-DD day. */
export function formatDayTick(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Compact token counts for axis ticks (1.2K / 3.4M). */
export function formatTokensTick(tokens: number): string {
  if (Math.abs(tokens) >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (Math.abs(tokens) >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
