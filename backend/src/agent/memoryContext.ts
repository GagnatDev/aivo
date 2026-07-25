import type { MemoryRow } from "../storage/memoryRepository.js";
import { gateMatches, tokenize } from "./tools/gate.js";

/**
 * Choosing which remembered facts go into the system prompt.
 *
 * Under the cap this is not a decision at all: every active memory is injected, pinned
 * first, and the block is byte-identical from turn to turn — which matters, because the
 * prompt is laid out most-stable-first for prefix caching (see buildContext).
 *
 * Over the cap it becomes one. Recency alone decides badly there: a fact from last month
 * that answers the question in front of you loses to whatever was saved most recently,
 * and the model is never told the cutoff happened, so it answers as if the missing facts
 * don't exist. So once the store overflows, the non-pinned slice is ranked by keyword
 * overlap with what the user just said, and the block ends with a line saying how many
 * facts are hidden and how to fetch them — just-in-time retrieval through the memory
 * tool, rather than raising the cap and paying for the whole store every turn.
 *
 * Relevance ranking is deliberately confined to the over-cap case: it makes the block
 * query-dependent, which costs the cached prefix, and that's only worth paying for when
 * something would otherwise be silently dropped.
 */

/** Words this short are almost always filler ("the", "og", "på") — noise as ranking signal. */
const MIN_KEYWORD_LENGTH = 3;

export interface MemoryInjection {
  /** The system-message block to inject, or null when there are no memories. */
  block: string | null;
  /** How many active memories didn't fit the cap. */
  hiddenCount: number;
}

/**
 * Build the "What you remember about this user" block from the user's active memories
 * (newest-first, as the memory repository's `listActive` returns them).
 */
export function buildMemoryBlock(
  memories: MemoryRow[],
  opts: {
    /** Max facts to inject. */
    limit: number;
    /** What the user just said — ranks the non-pinned slice when the cap bites. */
    queryText: string;
  },
): MemoryInjection {
  if (memories.length === 0) return { block: null, hiddenCount: 0 };

  const selected = selectMemories(memories, opts.limit, opts.queryText);
  const hiddenCount = memories.length - selected.length;
  const lines = selected.map((m) => `- ${m.category ? `[${m.category}] ` : ""}${m.content}`);
  // Tell the model the block is partial and how to reach the rest, so a missing fact is
  // a search away instead of an unknown unknown.
  if (hiddenCount > 0) {
    lines.push(
      `(${hiddenCount} more remembered ${hiddenCount === 1 ? "fact is" : "facts are"} not shown ` +
        "here — use the memory tool's 'search' action to look something up before saying you " +
        "don't know it, and don't re-save what you find.)",
    );
  }
  return { block: `What you remember about this user:\n${lines.join("\n")}`, hiddenCount };
}

/**
 * Pinned facts first (they're pinned precisely so they never fall out), then the rest.
 * The rest keep their newest-first order while everything fits; once the cap bites they
 * are ordered by how well they match `queryText`, with recency breaking ties.
 */
function selectMemories(memories: MemoryRow[], limit: number, queryText: string): MemoryRow[] {
  const pinned = memories.filter((m) => m.pinned);
  const rest = memories.filter((m) => !m.pinned);
  if (memories.length > limit) {
    const keywords = keywordsOf(queryText);
    if (keywords.size > 0) {
      // Stable sort: equal scores keep the newest-first order they came in with.
      rest.sort((a, b) => relevance(b, keywords) - relevance(a, keywords));
    }
  }
  return [...pinned, ...rest].slice(0, limit);
}

/**
 * How many distinct query keywords the memory mentions. Matching is the tool gate's
 * (exact / stem / small edit distance, see tools/gate.ts) rather than string equality:
 * the owner writes Norwegian as often as English, where the inflected form differs from
 * the stored one ("påminnelsen" vs "påminnelse"), and the same forgiving rules already
 * decide tool advertisement.
 */
function relevance(memory: MemoryRow, keywords: Set<string>): number {
  const text = `${memory.category ?? ""} ${memory.content}`;
  let score = 0;
  for (const keyword of keywords) {
    if (gateMatches([keyword], text)) score += 1;
  }
  return score;
}

/** Distinct words worth ranking on: too-short ones are filler in either language. */
function keywordsOf(text: string): Set<string> {
  return new Set(tokenize(text).filter((w) => w.length >= MIN_KEYWORD_LENGTH));
}
