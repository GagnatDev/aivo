/**
 * A one-method clock injected via {@link AgentDeps} so time-dependent business logic
 * (month rollover, approval expiry, stale-message acknowledgement, and the upcoming
 * scheduler) reads "now" from a dependency rather than ambiently. Production wires
 * {@link systemClock}; tests wire a settable fake so rollover/expiry/staleness are
 * deterministic instead of dependent on the wall clock.
 *
 * Note: this governs process-side time only. DB-side bucketing (`date_trunc(... now())`
 * in {@link LlmUsageRepository}) deliberately keeps using the database server's clock —
 * a single authoritative source for calendar-month/day spend windows.
 */
export interface Clock {
  now(): Date;
}

/** The production clock: real wall-clock time. */
export const systemClock: Clock = {
  now: () => new Date(),
};
