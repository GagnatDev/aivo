import type { AgreementStats } from "../storage/feedbackRepository.js";

/**
 * Cold-start rejected-list taper (docs/concept.md): early on, the digest shows a short
 * rejected list with reasons so the user can correct the boundary in both directions.
 * As the recent keep-rate rises, the list tapers to borderline calls only, then
 * disappears. The rate is a query over recent feedback, not a stored flag.
 */

// Below this many recent reactions the agent is still calibrating regardless of rate.
const MIN_SAMPLES = 20;
const FULL_LIST_MAX = 5;
const BORDERLINE_LIST_MAX = 2;

/** How many rejected-list entries to show given recent agreement. */
export function rejectedListLimit(stats: AgreementStats): number {
  if (stats.samples < MIN_SAMPLES || stats.rate < 0.85) return FULL_LIST_MAX;
  if (stats.rate < 0.95) return BORDERLINE_LIST_MAX;
  return 0;
}
