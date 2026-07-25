import { z } from "zod";

/**
 * The weather lane of `settings.proactivity` (a sibling of the digest lane — see
 * digest/proactivity.ts). It holds the owner-configured daily morning weather report's
 * state: whether it's on, the local hour it delivers at, a `last_report_date` watermark
 * (local YYYY-MM-DD of the last delivery, so the report fires once per day and a restart
 * past the hour self-heals rather than double-sending), and `run_requested_at` — the
 * chat-set "send it now" flag the next scheduler tick consumes, which overrides the
 * on/off switch just like the digest's does. The report reads the owner's `is_home`
 * weather_locations row for the place to forecast; the location itself is NOT stored
 * here.
 */

const weatherLaneSchema = z.object({
  enabled: z.boolean().default(false),
  report_hour: z.number().int().min(0).max(23).default(6),
  last_report_date: z.string().nullable().default(null),
  run_requested_at: z.string().datetime({ offset: true }).nullable().default(null),
});

export interface WeatherLane {
  enabled: boolean;
  reportHour: number;
  lastReportDate: string | null;
  runRequestedAt: Date | null;
}

/** Parse the weather lane out of a raw proactivity object; malformed input → defaults. */
export function parseWeatherLane(proactivity: Record<string, unknown>): WeatherLane {
  const parsed = weatherLaneSchema.safeParse(proactivity.weather ?? {});
  const lane = parsed.success
    ? parsed.data
    : { enabled: false, report_hour: 6, last_report_date: null, run_requested_at: null };
  return {
    enabled: lane.enabled,
    reportHour: lane.report_hour,
    lastReportDate: lane.last_report_date,
    runRequestedAt: lane.run_requested_at ? new Date(lane.run_requested_at) : null,
  };
}

/** Merge a lane change back into the raw proactivity object (other lanes untouched). */
export function withWeatherLane(
  proactivity: Record<string, unknown>,
  patch: Partial<WeatherLane>,
): Record<string, unknown> {
  const next = { ...parseWeatherLane(proactivity), ...patch };
  return {
    ...proactivity,
    weather: {
      enabled: next.enabled,
      report_hour: next.reportHour,
      last_report_date: next.lastReportDate,
      run_requested_at: next.runRequestedAt ? next.runRequestedAt.toISOString() : null,
    },
  };
}
