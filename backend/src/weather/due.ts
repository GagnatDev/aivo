import { localDate, localHour } from "../digest/due.js";
import type { WeatherLane } from "./proactivity.js";

/**
 * The pure "is the morning weather report due?" policy the minutely scheduler tick
 * evaluates — the weather sibling of digest/due.ts, reusing its timezone helpers. A
 * chat-requested run ("send the weather now") always fires. A scheduled run respects the
 * on/off switch, waits for the local delivery hour, and fires at most once per local day
 * (guarded by the lane's `last_report_date` watermark) — so downtime past the hour
 * self-heals on the next tick instead of skipping or repeating the day.
 */

export interface WeatherReportDueInput {
  now: Date;
  timezone: string;
  lane: WeatherLane;
}

export type WeatherReportDueReason = "requested" | "scheduled";

export function weatherReportDue(
  input: WeatherReportDueInput,
): { due: true; reason: WeatherReportDueReason } | { due: false } {
  if (input.lane.runRequestedAt) return { due: true, reason: "requested" };
  if (!input.lane.enabled) return { due: false };
  if (localHour(input.now, input.timezone) < input.lane.reportHour) return { due: false };
  if (input.lane.lastReportDate === localDate(input.now, input.timezone)) return { due: false };
  return { due: true, reason: "scheduled" };
}
