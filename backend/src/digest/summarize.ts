import { z } from "zod";
import type { ChatMessage } from "../llm/provider.js";
import { extractJsonObject } from "./llmJson.js";

/**
 * Stage 2 of the two-stage filter (docs/concept.md): per shortlisted video, confirm
 * relevance from the transcript and write the TL;DW. Pure prompt building + parsing;
 * the pipeline owns the call, the transcript fetch, and the persistence.
 */

export interface Stage2Video {
  title: string;
  channelTitle: string;
  description: string;
  durationSeconds: number | null;
}

export interface Stage2Verdict {
  decision: "pick" | "reject";
  /** 0–1 confidence in the decision. */
  confidence: number;
  /** Markdown bullet lines (without the leading "-"), 2–3 normally, 1 when brief. */
  summaryBullets: string[];
  /** One line of "why you're seeing this". */
  why: string;
  /** Short rejected-list reason; null for picks. */
  reason: string | null;
}

// One outlier transcript must not blow up a run's token spend (docs/concept.md's
// volume guard); ~16k chars ≈ 4k tokens.
export const TRANSCRIPT_CHAR_CAP = 16_000;
const DESCRIPTION_CHARS = 500;

export function buildStage2Messages(input: {
  profileBody: string;
  video: Stage2Video;
  transcript: string | null;
  /** Degraded mode: shorter summary to save output tokens. */
  brief: boolean;
}): ChatMessage[] {
  const bullets = input.brief ? "exactly 1 short bullet" : "2-3 short bullets";
  const source = input.transcript
    ? `Transcript (may be truncated):\n${input.transcript.slice(0, TRANSCRIPT_CHAR_CAP)}`
    : "No transcript is available — judge from the metadata only and lower your confidence.";
  const v = input.video;
  return [
    {
      role: "system",
      content:
        "You are the summary stage of a YouTube digest. Decide whether this video belongs in " +
        "the user's daily digest given their interest profile, and summarize its actual " +
        "content. Respond with ONLY a JSON object: " +
        '{"decision": "pick" | "reject", "confidence": 0.0, ' +
        `"summary": [${bullets} of what the video covers], ` +
        '"why": "one line: why the user is seeing this, tied to their profile", ' +
        '"reason": "only when rejecting: a short phrase for the rejected list"}.',
    },
    {
      role: "user",
      content:
        `Interest profile:\n${input.profileBody}\n\n` +
        `Video: "${v.title}" by ${v.channelTitle}` +
        (v.durationSeconds ? ` (${Math.round(v.durationSeconds / 60)} min)` : "") +
        `\nDescription: ${v.description.slice(0, DESCRIPTION_CHARS)}\n\n${source}`,
    },
  ];
}

const verdictSchema = z.object({
  decision: z.enum(["pick", "reject"]),
  confidence: z.coerce.number().optional(),
  summary: z.array(z.string()).optional(),
  why: z.string().optional(),
  reason: z.string().nullish(),
});

/** Parse the model's verdict; undefined when it isn't usable JSON. */
export function parseStage2Response(text: string | null): Stage2Verdict | undefined {
  const obj = extractJsonObject(text);
  if (!obj) return undefined;
  const parsed = verdictSchema.safeParse(obj);
  if (!parsed.success) return undefined;
  const d = parsed.data;
  return {
    decision: d.decision,
    confidence: Math.min(1, Math.max(0, d.confidence ?? 0.5)),
    summaryBullets: (d.summary ?? []).map((s) => s.trim()).filter(Boolean),
    why: d.why?.trim() ?? "",
    reason: d.reason?.trim() || null,
  };
}
