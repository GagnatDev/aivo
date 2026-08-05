// Types mirroring the dashboard digests API (backend routes/dashboard/digests.ts)
// and the small formatters the Digest History page uses.

import type { Money } from "./usage.js";
import type { StatusMeta } from "./palette.js";

export type DigestStatus = "pending" | "delivered" | "skipped_budget" | "failed";

/** Why a run failed (backend db/schema.enums.ts `DigestFailureKind`). */
export type DigestFailureKind = "youtube_auth" | "youtube_api" | "llm" | "unknown";

export interface DigestFailure {
  kind: DigestFailureKind;
  /** The recorded technical detail — shown so the owner never needs the pod log. */
  message: string;
}

export interface DigestRunSummary {
  id: string;
  /** The run's local calendar date, YYYY-MM-DD. */
  runDate: string;
  status: DigestStatus;
  coversSince: string;
  deliveredAt: string | null;
  createdAt: string;
  cost: Money;
  /** Set only on a failed run. */
  failure: DigestFailure | null;
  pickCount: number;
  rejectCount: number;
}

export interface YoutubeStatus {
  connected: boolean;
  title: string | null;
  subscriptionsSyncedAt: string | null;
  videosPolledAt: string | null;
  /** Where to re-run the consent handshake, or null when no OAuth client is configured. */
  oauthStartPath: string | null;
  /** The deployment-secret key the minted refresh token belongs in. */
  refreshTokenSecretKey: string;
}

export interface DigestRuns {
  runs: DigestRunSummary[];
  youtube: YoutubeStatus;
}

export interface FeedbackSummary {
  keep: number;
  drop: number;
  tooLong: number;
  wrongTopic: number;
  freeform: number;
}

export interface DigestItemVideo {
  id: string;
  title: string;
  channelTitle: string | null;
  durationSeconds: number | null;
  publishedAt: string;
  thumbnailUrl: string | null;
  summary: string | null;
  why: string | null;
}

export interface DigestItem {
  id: string;
  rank: number | null;
  confidence: number | null;
  reason: string | null;
  video: DigestItemVideo | null;
}

export interface DigestDetail {
  run: Omit<DigestRunSummary, "pickCount" | "rejectCount">;
  picks: DigestItem[];
  rejects: DigestItem[];
  feedback: FeedbackSummary;
}

/** "2 keep · 1 too long" — non-zero reaction counts, or null when none yet (D-4). */
export function summarizeFeedback(feedback: FeedbackSummary): string | null {
  const parts = [
    [feedback.keep, "keep"],
    [feedback.drop, "drop"],
    [feedback.tooLong, "too long"],
    [feedback.wrongTopic, "wrong topic"],
    [feedback.freeform, "freeform"],
  ] as const;
  const shown = parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return shown.length > 0 ? shown.join(" · ") : null;
}

/** Run lifecycle → status chip (same icon+label discipline as DEGRADATION_META). */
export const DIGEST_STATUS_META: Record<DigestStatus, StatusMeta> = {
  delivered: { label: "Delivered", color: "#0ca30c", icon: "●" },
  pending: { label: "Pending", color: "#fab219", icon: "▲" },
  skipped_budget: { label: "Skipped (budget)", color: "#ec835a", icon: "◼" },
  failed: { label: "Failed", color: "#d03b3b", icon: "✕" },
};

/** What each failure kind means, in the owner's terms — the headline above the detail. */
export const DIGEST_FAILURE_HEADLINES: Record<DigestFailureKind, string> = {
  youtube_auth: "YouTube access expired — reconnect the account to resume digests",
  youtube_api: "The YouTube API call failed — the next scheduled run retries",
  llm: "The model provider call failed — the next scheduled run retries",
  unknown: "The run failed unexpectedly — the next scheduled run retries",
};

/** Headline + recorded detail for a failed run, or null when the run didn't fail. */
export function describeFailure(failure: DigestFailure | null): string | null {
  if (!failure) return null;
  const headline = DIGEST_FAILURE_HEADLINES[failure.kind] ?? DIGEST_FAILURE_HEADLINES.unknown;
  return failure.message ? `${headline} (${failure.message})` : headline;
}

/**
 * Whether the YouTube connection is what's standing between the owner and a digest — the
 * newest run failed on an expired/revoked grant, or the account was never connected. Drives
 * whether the reconnect guide starts expanded (#83).
 */
export function needsReconnect(runs: DigestRunSummary[], youtube: YoutubeStatus): boolean {
  if (!youtube.connected) return true;
  // runs arrive newest-first; only the latest run's verdict is current.
  return runs[0]?.failure?.kind === "youtube_auth";
}

/** "12:34" / "1:02:03" video length from seconds; null when YouTube didn't say. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Stage-2 confidence as a whole percent, or null when the model gave none. */
export function formatConfidence(confidence: number | null): string | null {
  if (confidence == null) return null;
  return `${Math.round(confidence * 100)}%`;
}

/** The public watch link for a digest entry's video. */
export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** True when the video's publish/premiere instant is still in the future. */
export function isUpcoming(publishedAt: string, now: Date = new Date()): boolean {
  return new Date(publishedAt).getTime() > now.getTime();
}

/** Released picks keep API order; upcoming are sorted earliest-first. */
export function partitionDigestItems(
  picks: DigestItem[],
  now: Date = new Date(),
): { released: DigestItem[]; upcoming: DigestItem[] } {
  const released: DigestItem[] = [];
  const upcoming: DigestItem[] = [];
  for (const item of picks) {
    if (item.video && isUpcoming(item.video.publishedAt, now)) upcoming.push(item);
    else released.push(item);
  }
  upcoming.sort((a, b) => {
    const aAt = a.video ? new Date(a.video.publishedAt).getTime() : 0;
    const bAt = b.video ? new Date(b.video.publishedAt).getTime() : 0;
    return aAt - bAt;
  });
  return { released, upcoming };
}

/**
 * Weekday + date + time for a release instant (dashboard is English-only),
 * e.g. "Thursday, 6 Aug, 18:00".
 */
export function formatReleaseAt(iso: string, timeZone = "UTC"): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(iso));
  }
}
