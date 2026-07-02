import { z } from "zod";
import type { ChatMessage } from "../llm/provider.js";
import { extractJsonArray } from "./llmJson.js";

/**
 * Stage 1 of the two-stage filter (docs/concept.md): a single cheap-model call that
 * ranks every candidate's metadata (title + description + channel) against the
 * interest profile. Prompt building and response parsing are pure so they're testable
 * without a provider; the pipeline owns the call itself.
 */

export interface Stage1Candidate {
  id: string;
  title: string;
  channelTitle: string;
  description: string;
  durationSeconds: number | null;
}

export interface Stage1Score {
  id: string;
  /** 0–1 relevance against the profile. */
  score: number;
  /** Short phrase usable as a rejected-list reason ("news recap, you said no"). */
  reason: string | null;
}

// Metadata-only ranking doesn't need full descriptions; keep the prompt bounded.
const DESCRIPTION_CHARS = 300;
// When the model's response can't be parsed, every candidate gets this neutral score —
// the run degrades to "newest first" rather than aborting.
export const STAGE1_FALLBACK_SCORE = 0.5;

export function buildStage1Messages(
  profileBody: string,
  candidates: Stage1Candidate[],
): ChatMessage[] {
  const list = candidates.map((c) => ({
    id: c.id,
    channel: c.channelTitle,
    title: c.title,
    description: c.description.slice(0, DESCRIPTION_CHARS),
    minutes: c.durationSeconds ? Math.round(c.durationSeconds / 60) : null,
  }));
  return [
    {
      role: "system",
      content:
        "You are the ranking stage of a YouTube digest. Score each candidate video 0 to 1 " +
        "for how well it matches the user's interest profile, judging only from the metadata " +
        "given. Respond with ONLY a JSON array, one entry per video: " +
        '[{"id": "...", "score": 0.0, "reason": "..."}]. ' +
        '"reason" is a short phrase (max ~8 words) explaining the score from the profile\'s ' +
        'perspective, e.g. "news recap, you said no" — it is shown to the user for ' +
        "low-scoring videos.",
    },
    {
      role: "user",
      content: `Interest profile:\n${profileBody}\n\nCandidate videos:\n${JSON.stringify(list)}`,
    },
  ];
}

const scoreEntry = z.object({
  id: z.string(),
  score: z.coerce.number(),
  reason: z.string().nullish(),
});

/**
 * Parse the model's score array. Unknown ids are dropped, scores clamped to [0,1],
 * and any candidate the model omitted gets the neutral fallback score, so the caller
 * always receives exactly one score per candidate.
 */
export function parseStage1Response(text: string | null, candidateIds: string[]): Stage1Score[] {
  const byId = new Map<string, Stage1Score>();
  for (const raw of extractJsonArray(text) ?? []) {
    const parsed = scoreEntry.safeParse(raw);
    if (!parsed.success || !candidateIds.includes(parsed.data.id)) continue;
    byId.set(parsed.data.id, {
      id: parsed.data.id,
      score: Math.min(1, Math.max(0, parsed.data.score)),
      reason: parsed.data.reason?.trim() || null,
    });
  }
  return candidateIds.map(
    (id) => byId.get(id) ?? { id, score: STAGE1_FALLBACK_SCORE, reason: null },
  );
}
