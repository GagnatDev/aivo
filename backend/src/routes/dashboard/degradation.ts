import type { DegradationState } from "../../db/schema.enums.js";

/**
 * Plain-language explanations for the budget state machine (PRD U-6/O-3/M-3),
 * shared by the usage, models, and overview endpoints so every page tells the
 * same story. The percentages mirror the app-config thresholds in agent/budget.ts.
 */
export const DEGRADATION_DESCRIPTIONS: Record<DegradationState, string> = {
  normal: "Spending is within budget. Your preferred model tier is in use.",
  cheap_models:
    "Spend passed 80% of the monthly ceiling (or the daily soft cap), so replies use the cheap model tier until it resets.",
  proactive_paused:
    "Spend passed 90% of the monthly ceiling. Proactive work like the YouTube digest is paused; chat keeps answering on the cheap tier.",
  over_ceiling:
    "Spend is over the monthly ceiling. Aivo still answers — briefly, on the cheap tier — and tells you it is over budget.",
};
