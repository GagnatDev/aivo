import type { YoutubeIntegrations } from "../digest/pipeline.js";
import type { DiscoveredVideo, SubscribedChannel } from "../youtube/api.js";

/**
 * A scripted YoutubeIntegrations for pipeline/scheduler tests: a fixed subscription
 * list, a fixed pool of uploads (filtered by the same channel/since contract as the
 * real client), and a videoId→transcript map (missing id → null, i.e. no track).
 */
export function makeFakeYoutube(
  input: {
    subscriptions?: SubscribedChannel[];
    videos?: DiscoveredVideo[];
    transcripts?: Record<string, string>;
  } = {},
): YoutubeIntegrations {
  return {
    api: {
      async listSubscriptions() {
        return input.subscriptions ?? [];
      },
      async listNewVideos(channelIds, since) {
        return (input.videos ?? []).filter(
          (v) => channelIds.includes(v.channelId) && v.publishedAt > since,
        );
      },
    },
    transcripts: {
      async fetchTranscript(videoId) {
        return input.transcripts?.[videoId] ?? null;
      },
    },
  };
}
