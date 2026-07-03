/**
 * Defensive JSON extraction for the digest's LLM stages. Models (especially cheap
 * ones) wrap JSON in prose or code fences; these helpers find the first balanced
 * array/object in the text and parse it, returning undefined instead of throwing —
 * every caller has a deterministic fallback, so a malformed response degrades a run
 * rather than aborting it.
 */

function extractBalanced(text: string, open: "[" | "{"): string | undefined {
  const close = open === "[" ? "]" : "}";
  const start = text.indexOf(open);
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Parse the first balanced JSON array in the text, or undefined. */
export function extractJsonArray(text: string | null): unknown[] | undefined {
  if (!text) return undefined;
  const raw = extractBalanced(text, "[");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parse the first balanced JSON object in the text, or undefined. */
export function extractJsonObject(text: string | null): Record<string, unknown> | undefined {
  if (!text) return undefined;
  const raw = extractBalanced(text, "{");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
