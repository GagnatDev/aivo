import type { DegradationState } from "./usage.js";

/**
 * Categorical series palette (dark-surface steps), assigned to groups in fixed
 * order — never cycled, never re-ranked when a filter changes the series count.
 * Validated for the app's card surface (#171c26): lightness band, chroma floor,
 * CVD separation, and ≥3:1 contrast all pass (dataviz validator).
 */
export const SERIES_COLORS = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/** Chart chrome tuned to the app theme — recessive, hairline, text in ink tokens. */
export const CHART = {
  surface: "#171c26",
  grid: "#242c3a",
  axisText: "#8b94a7",
  baseline: "#2a3242",
  referenceLine: "#8b94a7",
} as const;

export interface StatusMeta {
  label: string;
  color: string;
  /** Status never rides on color alone — the glyph + label pair carries it. */
  icon: string;
}

/**
 * Budget state machine → status colors (reserved palette, distinct from series
 * slots; each state pairs icon + label so color never carries meaning alone).
 */
export const DEGRADATION_META: Record<DegradationState, StatusMeta> = {
  normal: { label: "Normal", color: "#0ca30c", icon: "●" },
  cheap_models: { label: "Cheap models", color: "#fab219", icon: "▲" },
  proactive_paused: { label: "Proactive paused", color: "#ec835a", icon: "◼" },
  over_ceiling: { label: "Over ceiling", color: "#d03b3b", icon: "✕" },
};
