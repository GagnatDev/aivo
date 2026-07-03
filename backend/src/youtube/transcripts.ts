import { logger } from "../logger.js";

/**
 * Port + implementation for stage-2 transcript retrieval. Uses the caption track
 * (auto-generated or uploaded) exposed on a video's watch page — the "transcript
 * library" approach locked in docs/technical-overview.md, implemented in-repo to avoid
 * an unmaintained dependency. This is the ToS-gray path the docs flag: on ANY failure
 * we return null and the pipeline records `transcript_status = unavailable`, falling
 * back to a metadata-only summary at lower confidence rather than dropping the video.
 */

export interface TranscriptSource {
  /** Plain-text transcript for a video, or null when no track is available. */
  fetchTranscript(videoId: string): Promise<string | null>;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated
}

/**
 * Pick the best caption track: prefer a human track over auto-generated ("asr"),
 * and English over other languages within each class; otherwise take what exists.
 * Exported for tests.
 */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const usable = tracks.filter((t) => t.baseUrl);
  const score = (t: CaptionTrack): number =>
    (t.kind === "asr" ? 0 : 2) + (t.languageCode?.startsWith("en") ? 1 : 0);
  return usable.sort((a, b) => score(b) - score(a))[0];
}

/** Strip a timedtext XML document down to plain text. Exported for tests. */
export function timedTextToPlain(xml: string): string {
  const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
  return texts
    .join(" ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the caption track list from a watch page's embedded player response. */
export function extractCaptionTracks(watchHtml: string): CaptionTrack[] {
  const marker = '"captionTracks":';
  const start = watchHtml.indexOf(marker);
  if (start === -1) return [];
  const arrayStart = start + marker.length;
  // The track list is a flat JSON array — find its end by bracket matching.
  let depth = 0;
  for (let i = arrayStart; i < watchHtml.length; i++) {
    const c = watchHtml[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(watchHtml.slice(arrayStart, i + 1)) as CaptionTrack[];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/** The real transcript source, scraping the watch page's caption track. */
export function createWatchPageTranscriptSource(): TranscriptSource {
  return {
    async fetchTranscript(videoId: string): Promise<string | null> {
      try {
        const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { "accept-language": "en" },
        });
        if (!watch.ok) return null;
        const track = pickCaptionTrack(extractCaptionTracks(await watch.text()));
        if (!track?.baseUrl) return null;
        const timedText = await fetch(track.baseUrl);
        if (!timedText.ok) return null;
        const plain = timedTextToPlain(await timedText.text());
        return plain.length > 0 ? plain : null;
      } catch (err) {
        logger.warn({ err, videoId }, "transcript fetch failed");
        return null;
      }
    },
  };
}
