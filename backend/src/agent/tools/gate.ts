/**
 * Fuzzy keyword gating for tool advertisement (see {@link selectToolSchemas} in
 * index.ts). Each gated tool lists trigger *keywords* rather than a hand-tuned regex;
 * this module decides whether the recent conversation trips any of them.
 *
 * Why fuzzy and not a regex: the old gates matched exact substrings, so a single wrong
 * letter — a voice transcription that came back "handeliste" instead of "handleliste",
 * or an owner's typo — silently stripped the capability for that turn, and the model,
 * unable to see the tool, would confabulate success instead of acting. Matching is
 * deliberately broad and biased toward inclusion: a false positive only wastes a few
 * prompt tokens, a false negative loses a capability. So a keyword matches when a word
 * in the text
 *   - equals it,
 *   - begins with it (stem match: "middag" → "middagen"; only for keywords ≥4 chars,
 *     so 2–3 letter triggers like "mat"/"kr" stay whole-word and don't over-fire), or
 *   - is within a small edit distance of it (typo/transcription tolerance), scaled to
 *     the keyword's length so short words aren't matched by everything.
 *
 * A keyword with whitespace ("shopping list", "per token") is a phrase: every part must
 * appear (each part matched by the same word rules). A keyword with no letters ("$",
 * "€") is a literal symbol trigger, matched by plain substring.
 */

/** Split text into lowercased word tokens, keeping Unicode letters/digits (æøå, é, …). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Longest keyword edit-distance budget by length: short words must match (near-)exactly. */
function editBudget(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

/**
 * True iff the Levenshtein distance between `a` and `b` is at most `max`. Bounded: the
 * length gap alone can rule it out, and each DP row short-circuits once its minimum
 * exceeds the budget, so this stays cheap on the many non-matches per call.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Does a single token satisfy a single-word keyword (exact / stem / fuzzy)? */
function wordMatches(token: string, keyword: string): boolean {
  if (token === keyword) return true;
  // Stem match ("handleliste" → "handlelisten"), but only for keywords long enough that
  // a prefix is meaningful — otherwise "mat" would swallow "match", "material", etc.
  if (keyword.length >= 4 && token.startsWith(keyword)) return true;
  const max = editBudget(keyword.length);
  if (max === 0) return false;
  if (withinEditDistance(token, keyword, max)) return true;
  // A typo on a stem that also carries a suffix ("handelisten" ~ "handleliste"): compare
  // just the leading region the keyword covers, so the suffix doesn't inflate the distance.
  if (
    token.length > keyword.length &&
    withinEditDistance(token.slice(0, keyword.length), keyword, max)
  ) {
    return true;
  }
  return false;
}

/** True iff any keyword trips against the given text (see the module doc for the rules). */
export function gateMatches(keywords: readonly string[], text: string): boolean {
  const lower = text.toLowerCase();
  const tokens = tokenize(lower);
  for (const raw of keywords) {
    const keyword = raw.toLowerCase().trim();
    if (!keyword) continue;
    if (!/\p{L}/u.test(keyword)) {
      // Symbol/literal trigger ("$", "€"): tokenizing drops it, so match the raw text.
      if (lower.includes(keyword)) return true;
      continue;
    }
    if (/\s/.test(keyword)) {
      const parts = keyword.split(/\s+/).filter(Boolean);
      if (parts.every((p) => tokens.some((tok) => wordMatches(tok, p)))) return true;
      continue;
    }
    if (tokens.some((tok) => wordMatches(tok, keyword))) return true;
  }
  return false;
}
