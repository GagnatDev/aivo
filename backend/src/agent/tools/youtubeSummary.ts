import { z } from "zod";
import { digestLanguageDirective, type Language } from "../../i18n/index.js";
import type { ChatMessage } from "../../llm/provider.js";
import { logger } from "../../logger.js";
import { parseYoutubeVideoId } from "../../youtube/videoId.js";
import { preCallCheck, recordUsageAndAlert } from "../budget.js";
import { resolveModel } from "../modelSelection.js";
import { parse, type AgentTool, type ToolContext } from "./index.js";

/**
 * On-demand key-points summary of ANY public YouTube video, from its caption-track
 * transcript (the same watch-page scraper the digest's stage 2 uses) — not limited to
 * digest/subscription videos. Open to every user (not owner-gated): the LLM sub-call
 * is metered against the calling user's own budget, same as their chat turns.
 *
 * The summarization happens HERE as a dedicated sub-call rather than by returning the
 * transcript for the main loop to digest: a transcript runs to ~16k chars, which would
 * be truncated by the tool-result token cap and then replayed into every subsequent
 * round-trip of the conversation. The sub-call keeps the transcript out of the turn
 * context entirely; only the finished bullets come back.
 */

// One outlier transcript must not blow up the call's token spend — the digest's
// stage-2 volume guard (docs/concept.md), mirrored here rather than imported because
// digest/ already imports agent/ and the dependency must not run both ways.
const TRANSCRIPT_CHAR_CAP = 16_000;

const summaryArgs = z.object({
  video: z.string().min(1),
});

const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/** Prompt for the summary sub-call. Exported for tests. */
export function buildVideoSummaryMessages(input: {
  videoId: string;
  transcript: string;
  language: Language;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You summarize YouTube videos from their transcripts. Write the key points of the " +
        "video as 5-8 short markdown bullet lines (each starting with '- '), concrete and " +
        "specific to what the video actually covers — no preamble, no closing line. " +
        // Same rationale as the digest stages: this text reaches the user (relayed by the
        // agent), and the sub-call has no conversation to honour a language override from.
        digestLanguageDirective(input.language),
    },
    {
      role: "user",
      content:
        `Video: ${watchUrl(input.videoId)}\n` +
        `Transcript (may be truncated):\n${input.transcript.slice(0, TRANSCRIPT_CHAR_CAP)}`,
    },
  ];
}

export const youtubeSummaryTool: AgentTool = {
  // Bilingual keyword gate (English + Norwegian, the owner's usual language) — see
  // reminders.ts and gate.ts.
  gate: [
    "youtube",
    "youtu",
    "video",
    "watch",
    "summary",
    "summarize",
    "transcript",
    "sammendrag",
    "oppsummering",
    "oppsummer",
    "transkripsjon",
  ],
  schema: {
    name: "youtube_summary",
    description:
      "Summarize the key points of any YouTube video from its transcript. Call this when the " +
      "user pastes a YouTube link or video id and wants to know what it's about — 'summarize " +
      "this video', 'what are the key points?', 'hva handler denne videoen om?'. Works for any " +
      "public video with captions, not just digest videos. Pass the URL or id exactly as the " +
      "user gave it. Returns key-point bullets to relay to the user; if the video has no " +
      "captions it says so instead.",
    parameters: {
      type: "object",
      properties: {
        video: {
          type: "string",
          description: "the video's URL (youtube.com/watch, youtu.be, shorts) or 11-char id",
        },
      },
      required: ["video"],
    },
  },
  async execute(args, ctx) {
    const p = parse(summaryArgs, args);
    if (!p.ok) return p.error;

    const videoId = parseYoutubeVideoId(p.value.video);
    if (!videoId) {
      return `"${p.value.video}" doesn't look like a YouTube URL or video id — ask the user for the video link.`;
    }
    const transcript = await ctx.deps.transcripts.fetchTranscript(videoId);
    if (!transcript) {
      return (
        `No transcript is available for ${watchUrl(videoId)} — the video has no captions, ` +
        "or it is private/unavailable. It can't be summarized."
      );
    }
    return summarize(ctx, videoId, transcript);
  },
};

/** The metered LLM sub-call: premium tier unless budget degradation coerces it down. */
async function summarize(ctx: ToolContext, videoId: string, transcript: string): Promise<string> {
  const { deps, userId } = ctx;
  const check = await preCallCheck(deps, userId, "premium");
  const model = await resolveModel(deps, check.coercedTier);

  let result: Awaited<ReturnType<typeof deps.llm.chat>>;
  try {
    result = await deps.llm.chat({
      model,
      messages: buildVideoSummaryMessages({ videoId, transcript, language: ctx.language }),
      maxTokens: deps.config.llmMaxOutputTokens,
    });
  } catch (err) {
    logger.warn({ err, videoId }, "video summary sub-call failed");
    return "The summary request to the model failed — try again shortly.";
  }
  const record = await recordUsageAndAlert(deps, userId, "video_summary", model, result.usage);

  const content = result.content?.trim();
  if (!content) return "The model returned an empty summary — try again.";
  // The loop only surfaces alerts from its own round-trips, so an alert crossed by
  // this sub-call would otherwise be swallowed (the watermark is already bumped).
  const alertNote = record.alertPct
    ? `\n\n[Budget note: this crossed ${record.alertPct}% of the monthly budget — mention it to the user.]`
    : "";
  return `Key points of ${watchUrl(videoId)} (from its transcript):\n${content}${alertNote}`;
}
