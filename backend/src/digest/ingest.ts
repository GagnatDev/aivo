import type { AgentDeps } from "../agent/deps.js";
import type { YoutubeIntegrations } from "./pipeline.js";

/**
 * The digest's discovery step, split out of pipeline.ts so that file stays about the
 * two-stage filter. Refreshes the subscription cache (when stale) and polls the active
 * channels for new uploads. Both calls hit the network and are the pipeline's most
 * likely failure point — an expired OAuth refresh token surfaces here as a
 * `YoutubeApiError` the caller turns into a failed run.
 */

// A full subscriptions.list is 1 quota unit per 50 channels but rarely changes; ~daily
// is enough to notice a new subscription before the next digest.
const SUBSCRIPTION_SYNC_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export async function ingestNewVideos(
  deps: AgentDeps,
  yt: YoutubeIntegrations,
  now: Date,
  coversSince: Date,
): Promise<void> {
  const account = await deps.youtubeAccount.getOrCreate();
  const syncedAt = account.subscriptions_synced_at?.getTime() ?? 0;
  if (now.getTime() - syncedAt > SUBSCRIPTION_SYNC_MAX_AGE_MS) {
    await deps.youtubeChannels.syncSubscriptions(await yt.api.listSubscriptions(), now);
    await deps.youtubeAccount.markSubscriptionsSynced(now);
  }
  const active = await deps.youtubeChannels.listActive();
  const discovered = await yt.api.listNewVideos(
    active.map((c) => c.id),
    account.videos_polled_at ?? coversSince,
  );
  await deps.videos.upsertDiscovered(
    discovered.map((v) => ({
      id: v.id,
      channelId: v.channelId,
      title: v.title,
      description: v.description,
      durationSeconds: v.durationSeconds,
      publishedAt: v.publishedAt,
      scheduledStartTime: v.scheduledStartTime,
      thumbnailUrl: v.thumbnailUrl,
    })),
  );
  await deps.youtubeAccount.markVideosPolled(now);
}
