import type { DigestLane } from "./proactivity.js";

/**
 * The pure "is a digest due?" policy the minutely scheduler tick evaluates. Time
 * arithmetic is calendrical in the user's configured timezone: the digest fires the
 * first tick at/after `digest_hour` local on a day that is at least
 * `digest_interval_days` after the last run's date — so a restart or downtime past the
 * hour self-heals on the next tick instead of skipping the day.
 */

/** `YYYY-MM-DD` for an instant in a timezone (falls back to UTC on a bad tz string). */
export function localDate(now: Date, timeZone: string): string {
  return dateTimeParts(now, timeZone).date;
}

/** 0–23 local hour for an instant in a timezone (UTC fallback on a bad tz string). */
export function localHour(now: Date, timeZone: string): number {
  return dateTimeParts(now, timeZone).hour;
}

function dateTimeParts(now: Date, timeZone: string): { date: string; hour: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    // A user-set timezone string may be invalid; UTC beats crashing the scheduler.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  }
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/** Whole days between two `YYYY-MM-DD` dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface DigestDueInput {
  now: Date;
  timezone: string;
  digestHour: number;
  intervalDays: number;
  lane: DigestLane;
  /** `run_date` of the user's latest digest (any status), or null if none ever ran. */
  lastRunDate: string | null;
}

export type DigestDueReason = "requested" | "scheduled";

/**
 * Decide whether a digest run is due now. A chat-requested run ("run it now") always
 * fires — an explicit ask overrides pause/disable. Scheduled runs respect the lane's
 * off switches, the local delivery hour, and the configured interval.
 */
export function digestDue(
  input: DigestDueInput,
): { due: true; reason: DigestDueReason } | { due: false } {
  if (input.lane.runRequestedAt) return { due: true, reason: "requested" };
  if (!input.lane.enabled) return { due: false };
  if (input.lane.pausedUntil && input.lane.pausedUntil > input.now) return { due: false };
  if (localHour(input.now, input.timezone) < input.digestHour) return { due: false };
  const today = localDate(input.now, input.timezone);
  if (input.lastRunDate && daysBetween(input.lastRunDate, today) < input.intervalDays) {
    return { due: false };
  }
  return { due: true, reason: "scheduled" };
}
