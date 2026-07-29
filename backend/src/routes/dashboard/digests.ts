import { Router } from "express";
import { z } from "zod";
import type { DigestItemRow } from "../../storage/digestItemRepository.js";
import type { DigestRow } from "../../storage/digestRepository.js";
import type { VideoRow } from "../../storage/videoRepository.js";
import type { DashboardDeps } from "./index.js";
import { money } from "./money.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function runJson(run: DigestRow) {
  return {
    id: run.id,
    runDate: run.run_date,
    status: run.status,
    coversSince: run.covers_since.toISOString(),
    deliveredAt: run.delivered_at?.toISOString() ?? null,
    createdAt: run.created_at.toISOString(),
    cost: money(Number(run.cost_cents)),
    // Why a `failed` run failed (#83): without this the dashboard showed such a run as
    // Pending and the cause lived only in the pod log. Null on every other status.
    failure: run.failure_kind
      ? { kind: run.failure_kind, message: run.failure_message ?? "" }
      : null,
  };
}

function itemJson(
  item: DigestItemRow,
  videos: Map<string, VideoRow>,
  channelTitles: Map<string, string>,
) {
  const video = videos.get(item.video_id);
  return {
    id: item.id,
    rank: item.rank,
    confidence: item.confidence,
    reason: item.reason,
    video: video
      ? {
          id: video.id,
          title: video.title,
          channelTitle: channelTitles.get(video.channel_id) ?? null,
          durationSeconds: video.duration_seconds,
          publishedAt: video.published_at.toISOString(),
          thumbnailUrl: video.thumbnail_url,
          summary: video.summary,
          why: video.why,
        }
      : null,
  };
}

/**
 * Digest history endpoints (M5, PRD §4.6): the run list with pick/reject totals
 * and per-run cost (D-1, D-3), and the drill-in with ranked picks, the rejected
 * list, and linked video metadata (D-2). Owner-scoped like everything YouTube —
 * the v1 owner-only gate makes that implicit; rows are still filtered by user_id
 * so household members never see the owner's runs once the gate relaxes.
 */
export function digestsRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/digests", async (req, res) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const [runs, account] = await Promise.all([
      deps.digests.listForUser(req.userId!, query.data.limit),
      deps.youtubeAccount.find(),
    ]);
    const counts = await deps.digestItems.countsByDigests(runs.map((r) => r.id));
    res.json({
      runs: runs.map((run) => ({
        ...runJson(run),
        pickCount: counts.get(run.id)?.picks ?? 0,
        rejectCount: counts.get(run.id)?.rejects ?? 0,
      })),
      // D-5: connection status — metadata and sync watermarks, never tokens.
      youtube: {
        connected: account?.youtube_channel_id != null,
        title: account?.title ?? null,
        subscriptionsSyncedAt: account?.subscriptions_synced_at?.toISOString() ?? null,
        videosPolledAt: account?.videos_polled_at?.toISOString() ?? null,
      },
    });
  });

  router.get("/api/dashboard/digests/:id", async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "bad_request", issues: params.error.issues });
      return;
    }
    const run = await deps.digests.findByIdForUser(params.data.id, req.userId!);
    if (!run) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // listByDigest is picks-by-rank first, then rejects; hydrate the video
    // metadata (title, channel, duration, summary) the Discord message shows.
    const items = await deps.digestItems.listByDigest(run.id);
    const videoRows = await deps.videos.findByIds(items.map((i) => i.video_id));
    const videos = new Map(videoRows.map((v) => [v.id, v]));
    const channelTitles = await deps.videos.channelTitles([
      ...new Set(videoRows.map((v) => v.channel_id)),
    ]);
    const feedback = await deps.feedback.countsForDigest(run.id);
    res.json({
      run: runJson(run),
      picks: items.filter((i) => i.kind === "pick").map((i) => itemJson(i, videos, channelTitles)),
      rejects: items
        .filter((i) => i.kind === "reject")
        .map((i) => itemJson(i, videos, channelTitles)),
      // D-4: the user's reactions on this run's delivered items.
      feedback: {
        keep: feedback.keep ?? 0,
        drop: feedback.drop ?? 0,
        tooLong: feedback.too_long ?? 0,
        wrongTopic: feedback.wrong_topic ?? 0,
        freeform: feedback.freeform ?? 0,
      },
    });
  });

  return router;
}
