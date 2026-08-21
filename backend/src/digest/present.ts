import { localeFor, type Language } from "../i18n/index.js";
import type { DeliverablePick } from "./pipeline.js";

/**
 * Presentation helpers for digest picks: split already-watchable videos from those that
 * haven't come out yet (YouTube premieres / scheduled live streams), and format the
 * release instant in the owner's language + timezone.
 *
 * "Not out yet" cannot be read off `publishedAt` alone. That value is the uploads-playlist
 * publish instant, and YouTube publishes a premiere's placeholder the moment it is
 * announced — so a video releasing tomorrow already has a `publishedAt` in the past. The
 * release instant is `scheduledStartTime` when YouTube reported one (youtube/api.ts reads
 * it from `liveStreamingDetails`); the later of the two otherwise, so a genuinely
 * future-dated publish still counts as unreleased.
 */

/** What both timestamps a video can carry look like, wherever they come from. */
export interface Releasable {
  publishedAt: Date;
  scheduledStartTime: Date | null;
}

/** When a video becomes watchable: its premiere time, or its publish instant. */
export function releaseAt(video: Releasable): Date {
  const scheduled = video.scheduledStartTime;
  if (!scheduled) return video.publishedAt;
  return scheduled.getTime() > video.publishedAt.getTime() ? scheduled : video.publishedAt;
}

export function isUpcoming(video: Releasable, now: Date): boolean {
  return releaseAt(video).getTime() > now.getTime();
}

/** Released picks keep their confidence order; upcoming are sorted earliest-first. */
export function partitionPicks(
  picks: readonly DeliverablePick[],
  now: Date,
): { released: DeliverablePick[]; upcoming: DeliverablePick[] } {
  const released: DeliverablePick[] = [];
  const upcoming: DeliverablePick[] = [];
  for (const pick of picks) {
    if (isUpcoming(pick, now)) upcoming.push(pick);
    else released.push(pick);
  }
  upcoming.sort((a, b) => releaseAt(a).getTime() - releaseAt(b).getTime());
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
