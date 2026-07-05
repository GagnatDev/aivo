// Types mirroring the dashboard digests API (backend routes/dashboard/digests.ts)
// and the small formatters the Digest History page uses.

import type { Money } from "./usage.js";
import type { StatusMeta } from "./palette.js";

export type DigestStatus = "pending" | "delivered" | "skipped_budget";

export interface DigestRunSummary {
  id: string;
  /** The run's local calendar date, YYYY-MM-DD. */
  runDate: string;
  status: DigestStatus;
  coversSince: string;
  deliveredAt: string | null;
  createdAt: string;
  cost: Money;
  pickCount: number;
  rejectCount: number;
}

export interface DigestRuns {
  runs: DigestRunSummary[];
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
}

/** Run lifecycle → status chip (same icon+label discipline as DEGRADATION_META). */
export const DIGEST_STATUS_META: Record<DigestStatus, StatusMeta> = {
  delivered: { label: "Delivered", color: "#0ca30c", icon: "●" },
  pending: { label: "Pending", color: "#fab219", icon: "▲" },
  skipped_budget: { label: "Skipped (budget)", color: "#ec835a", icon: "◼" },
};

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
