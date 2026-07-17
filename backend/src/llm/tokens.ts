import type { ChatMessage, ToolSchema } from "./provider.js";

// Per-message framing overhead (role markers, separators) in approximate tokens.
const PER_MESSAGE_OVERHEAD = 4;
// Roughly four characters per token for English-ish text. This is a heuristic, not a
// real tokenizer: Scaleway's models aren't GPT-tokenized, so exactness is illusory and
// a wasm tokenizer would be heavy and still wrong. The gate that consumes this
// over-estimates output (uses max_tokens), and the *actual* cost is always computed
// post-call from the provider's reported usage — so billing never depends on this.
const CHARS_PER_TOKEN = 4;

/** Approximate token count of a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Cut `text` down to roughly `maxTokens` tokens, using the same chars-per-token
 * heuristic as {@link estimateTokens} (so it's approximate by design — the point is a
 * bound, not exactness). Returns the text unchanged when it already fits, and reports
 * whether it was cut so the caller can attach a truncation notice.
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  const maxChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/** Approximate input tokens for a prepared request (messages + tool schemas). */
export function estimateRequestTokens(messages: ChatMessage[], tools?: ToolSchema[]): number {
  let total = 0;
  for (const m of messages) {
    total += PER_MESSAGE_OVERHEAD + estimateTokens(m.content ?? "");
    for (const tc of m.tool_calls ?? []) {
      total += estimateTokens(tc.name) + estimateTokens(tc.arguments);
    }
  }
  if (tools?.length) {
    // The serialized tool schemas are sent every call and can be sizeable.
    total += estimateTokens(JSON.stringify(tools));
  }
  return total;
}
