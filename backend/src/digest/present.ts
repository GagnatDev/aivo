import { localeFor, type Language } from "../i18n/index.js";
import type { DeliverablePick } from "./pipeline.js";

/**
 * Presentation helpers for digest picks: split already-out videos from those whose
 * `publishedAt` is still in the future (YouTube premieres / scheduled uploads), and
 * format the release instant in the owner's language + timezone.
 */

export function isUpcoming(publishedAt: Date, now: Date): boolean {
  return publishedAt.getTime() > now.getTime();
}

/** Released picks keep their confidence order; upcoming are sorted earliest-first. */
export function partitionPicks(
  picks: readonly DeliverablePick[],
  now: Date,
): { released: DeliverablePick[]; upcoming: DeliverablePick[] } {
  const released: DeliverablePick[] = [];
  const upcoming: DeliverablePick[] = [];
  for (const pick of picks) {
    if (isUpcoming(pick.publishedAt, now)) upcoming.push(pick);
    else released.push(pick);
  }
  upcoming.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  return { released, upcoming };
}

/**
 * Local weekday + date + time for a release instant, e.g. "Thursday 7 Aug, 18:00"
 * (locale punctuation varies). Falls back to UTC on a bad timezone string (same
 * policy as digest/due.ts).
 */
export function formatReleaseAt(at: Date, timeZone: string, lang: Language): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat(localeFor(lang), { ...opts, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(localeFor(lang), { ...opts, timeZone: "UTC" }).format(at);
  }
}
