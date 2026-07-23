import { localDate } from "../digest/due.js";
import type { Forecast, ForecastInstant } from "./client.js";

/**
 * Presentation for forecasts: MET symbol codes → friendly labels/emoji, timezone-aware
 * daily bucketing, and the two renderers — {@link summarizeForecast} for the chat tool
 * (data the model relays) and {@link morningReportText} for the templated daily push
 * (no LLM in the loop, like reminder/digest delivery). All pure and unit-tested; the
 * timezone is threaded in because bucketing "today"/"tomorrow" is local, not UTC.
 */

export interface ForecastDay {
  /** Local YYYY-MM-DD. */
  date: string;
  minTempC: number | null;
  maxTempC: number | null;
  precipitationMm: number;
  symbolCode: string | null;
}

// Base MET symbol tokens (after stripping _day/_night/_polartwilight and any _and_thunder
// suffix) → human labels. Anything not listed is prettified from the token itself, so a
// new/rare code still renders readably instead of blank.
const SYMBOL_LABELS: Record<string, string> = {
  clearsky: "Clear sky",
  fair: "Fair",
  partlycloudy: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  lightrainshowers: "Light rain showers",
  rainshowers: "Rain showers",
  heavyrainshowers: "Heavy rain showers",
  lightrain: "Light rain",
  rain: "Rain",
  heavyrain: "Heavy rain",
  lightsleetshowers: "Light sleet showers",
  sleetshowers: "Sleet showers",
  heavysleetshowers: "Heavy sleet showers",
  lightsleet: "Light sleet",
  sleet: "Sleet",
  heavysleet: "Heavy sleet",
  lightsnowshowers: "Light snow showers",
  snowshowers: "Snow showers",
  heavysnowshowers: "Heavy snow showers",
  lightsnow: "Light snow",
  snow: "Snow",
  heavysnow: "Heavy snow",
};

/** Strip the day/night variant and the (glued) "andthunder" suffix, returning the base
 * token — MET codes read like "rainshowersandthunder_day", not "..._and_thunder". */
function baseSymbol(code: string): string {
  return code.replace(/_(day|night|polartwilight)$/, "").replace(/andthunder$/, "");
}

/** Friendly label for a MET symbol code (e.g. "partlycloudy_day" → "Partly cloudy"). */
export function symbolLabel(code: string | null): string {
  if (!code) return "—";
  const base = baseSymbol(code);
  const label =
    SYMBOL_LABELS[base] ?? base.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return code.includes("thunder") ? `${label} with thunder` : label;
}

/** A weather emoji for a MET symbol code; day/night aware for clear/fair conditions. */
export function symbolEmoji(code: string | null): string {
  if (!code) return "";
  const base = baseSymbol(code);
  const night = code.includes("_night");
  if (code.includes("thunder")) return "⛈️";
  if (base.includes("snow")) return "🌨️";
  if (base.includes("sleet")) return "🌨️";
  if (base.includes("rain")) return base.includes("showers") ? "🌦️" : "🌧️";
  if (base === "fog") return "🌫️";
  if (base === "cloudy") return "☁️";
  if (base === "partlycloudy") return night ? "☁️" : "⛅";
  if (base === "fair") return night ? "🌙" : "🌤️";
  if (base === "clearsky") return night ? "🌙" : "☀️";
  return "";
}

/** "18°" / "-4°" — whole degrees, or "—" when unknown. */
function temp(c: number | null): string {
  return c === null ? "—" : `${Math.round(c)}°`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass point wind is blowing *from*, from a direction in degrees. */
export function compass(deg: number | null): string {
  if (deg === null) return "";
  return COMPASS[Math.round(deg / 45) % 8] ?? "";
}

/** Local HH:MM for an instant in a timezone (UTC fallback on a bad tz, like digest/due). */
export function localTime(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(iso));
  }
}

/** "Thursday 24 Jul" for a local YYYY-MM-DD (used in the report header/day lines). */
export function labelDay(localYmd: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone,
  };
  // Anchor at local noon so the weekday can't slip across a DST/offset boundary.
  const at = new Date(`${localYmd}T12:00:00Z`);
  try {
    return new Intl.DateTimeFormat("en-GB", opts).format(at);
  } catch {
    return localYmd;
  }
}

/** Bucket a forecast's steps into per-local-day summaries (min/max temp, total precip,
 * a representative midday symbol), earliest day first. */
export function dailyBuckets(forecast: Forecast, timeZone: string): ForecastDay[] {
  const byDate = new Map<string, ForecastInstant[]>();
  for (const step of forecast.series) {
    const date = localDate(new Date(step.time), timeZone);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(step);
    else byDate.set(date, [step]);
  }
  return [...byDate.entries()].map(([date, steps]) => {
    const temps = steps.map((s) => s.temperatureC).filter((t): t is number => t !== null);
    const precip = steps.reduce((sum, s) => sum + (s.precipitationMm ?? 0), 0);
    // Representative symbol: the step nearest local 12:00 that has one.
    const withSymbol = steps.filter((s) => s.symbolCode);
    const midday = withSymbol.sort(
      (a, b) => Math.abs(hourOf(a.time, timeZone) - 12) - Math.abs(hourOf(b.time, timeZone) - 12),
    )[0];
    return {
      date,
      minTempC: temps.length ? Math.min(...temps) : null,
      maxTempC: temps.length ? Math.max(...temps) : null,
      precipitationMm: Math.round(precip * 10) / 10,
      symbolCode: midday?.symbolCode ?? null,
    };
  });
}

/** Today's steps nearest ≈09/12/15/18 local (within 2h), de-duplicated, in time order. */
function daytimeSteps(forecast: Forecast, timeZone: string, today: string): ForecastInstant[] {
  const todaySteps = forecast.series.filter((s) => localDate(new Date(s.time), timeZone) === today);
  const picked = new Map<string, ForecastInstant>();
  for (const target of [9, 12, 15, 18]) {
    let best: ForecastInstant | undefined;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const s of todaySteps) {
      const diff = Math.abs(hourOf(s.time, timeZone) - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    if (best && bestDiff <= 2) picked.set(best.time, best);
  }
  return [...picked.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function hourOf(iso: string, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(
        new Date(iso),
      ),
    );
  } catch {
    return new Date(iso).getUTCHours();
  }
}

/** One "now" / current-conditions line from the first forecast step. */
function currentLine(cur: ForecastInstant): string {
  const wind =
    cur.windSpeedMps === null
      ? ""
      : `, wind ${Math.round(cur.windSpeedMps)} m/s ${compass(cur.windFromDirectionDeg)}`.trimEnd();
  const rain =
    cur.precipitationMm && cur.precipitationMm > 0 ? `, ${cur.precipitationMm} mm/h` : "";
  return `${temp(cur.temperatureC)} ${symbolEmoji(cur.symbolCode)} ${symbolLabel(cur.symbolCode)}${wind}${rain}`.trim();
}

function dayLine(day: ForecastDay, timeZone: string): string {
  const range =
    day.minTempC === null
      ? "—"
      : `${Math.round(day.minTempC)}–${Math.round(day.maxTempC ?? day.minTempC)}°`;
  const rain = day.precipitationMm > 0 ? `, ${day.precipitationMm} mm` : "";
  return `${labelDay(day.date, timeZone)}: ${range} ${symbolEmoji(day.symbolCode)} ${symbolLabel(day.symbolCode)}${rain}`.trim();
}

export interface SummaryOptions {
  /** How many upcoming hourly steps to list. Default 5. */
  hours?: number;
  /** How many day summaries to list. Default 3. */
  days?: number;
}

/**
 * A compact multi-section forecast summary for the chat tool: current conditions, the
 * next few hourly steps, and a few daily summaries. Returned as the tool result for the
 * model to relay or condense — not shown to the user verbatim.
 */
export function summarizeForecast(
  locationName: string,
  forecast: Forecast,
  timeZone: string,
  opts: SummaryOptions = {},
): string {
  const cur = forecast.series[0];
  if (!cur) return `No forecast data available for ${locationName}.`;
  const lines = [`Forecast for ${locationName} (updated ${forecast.updatedAt ?? "?"}):`];
  lines.push(`Now: ${currentLine(cur)}`);

  const upcoming = forecast.series.slice(1, 1 + (opts.hours ?? 5));
  if (upcoming.length) {
    lines.push("Next hours:");
    for (const s of upcoming) {
      const rain = s.precipitationMm && s.precipitationMm > 0 ? ` ${s.precipitationMm} mm` : "";
      lines.push(
        `  ${localTime(s.time, timeZone)} · ${temp(s.temperatureC)} ${symbolEmoji(s.symbolCode)} ${symbolLabel(s.symbolCode)}${rain}`,
      );
    }
  }

  const days = dailyBuckets(forecast, timeZone).slice(0, opts.days ?? 3);
  if (days.length) {
    lines.push("Days:");
    for (const d of days) lines.push(`  ${dayLine(d, timeZone)}`);
  }
  return lines.join("\n");
}

/**
 * The templated daily morning report pushed to Discord (no LLM in the loop). A greeting
 * header, today's high/low + condition + precipitation, the key daytime hours, and a
 * one-line look at tomorrow when the forecast reaches it.
 */
export function morningReportText(
  locationName: string,
  forecast: Forecast,
  timeZone: string,
  now: Date,
): string {
  const days = dailyBuckets(forecast, timeZone);
  const cur = forecast.series[0];
  const header = `🌅 **Good morning! Weather for ${locationName} — ${labelDay(localDate(now, timeZone), timeZone)}**`;
  if (!cur || days.length === 0) {
    return `${header}\nI couldn't read a forecast for ${locationName} right now.`;
  }

  const lines = [header, `**Now:** ${currentLine(cur)}`];
  const today = localDate(now, timeZone);
  const todayBucket = days.find((d) => d.date === today) ?? days[0];
  if (todayBucket) {
    lines.push(`**Today:** ${dayLine(todayBucket, timeZone).replace(/^[^:]+: /, "")}`);
  }

  // Key daytime hours (≈09/12/15/18 local) — pick today's step nearest each target so
  // this works whether the source resolution is hourly or (further out) 6-hourly.
  for (const s of daytimeSteps(forecast, timeZone, today)) {
    const rain = s.precipitationMm && s.precipitationMm > 0 ? ` · ${s.precipitationMm} mm` : "";
    lines.push(
      `  ${localTime(s.time, timeZone)} · ${temp(s.temperatureC)} ${symbolEmoji(s.symbolCode)} ${symbolLabel(s.symbolCode)}${rain}`,
    );
  }

  const tomorrow = days.find((d) => d.date > today);
  if (tomorrow) lines.push(`**Tomorrow:** ${dayLine(tomorrow, timeZone).replace(/^[^:]+: /, "")}`);
  return lines.join("\n");
}
