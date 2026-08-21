import { createHash } from "node:crypto";

/**
 * The tool loop's stuck-model detector, kept out of the loop itself so its rules are
 * unit-testable without running a turn.
 *
 * A model that keeps re-issuing the same tool call is a common open-model failure mode,
 * and the loop's backstop is to stop and force a plain-text answer. The naive version of
 * that check — "this exact `name:rawArgs` ran before this turn" — also fires on the
 * legitimate read-after-write pattern (`reminder.list` → `reminder.cancel` →
 * `reminder.list` to confirm), cutting the turn short and making the model answer from
 * data it has just invalidated.
 *
 * So a call counts as a repeat only when it ran before **and returned the same result**.
 * That is what "stuck" actually means: the model asking a question it already has the
 * answer to. A re-read after a mutation returns different text, so it reads as progress;
 * a model spinning on an unchanged read still trips the detector on the very next round.
 * (The alternative — tools declaring `readonly: true` — doesn't fit this registry: tools
 * are action-based, so `reminder` is both a reader and a mutator depending on its args.)
 *
 * Results are stored as a hash rather than the text, so a turn's worth of large tool
 * results isn't retained twice.
 */
export class RepeatTracker {
  /** Call signature → fingerprint of the result it last produced. */
  private readonly seen = new Map<string, string>();

  /**
   * Record an executed call and report whether it repeated an earlier identical call
   * that produced an identical result.
   */
  record(name: string, rawArgs: string, result: string): boolean {
    const signature = toolCallSignature(name, rawArgs);
    const fingerprint = createHash("sha256").update(result).digest("hex");
    const previous = this.seen.get(signature);
    this.seen.set(signature, fingerprint);
    return previous === fingerprint;
  }
}

/**
 * A stable identity for a tool call: its name plus its arguments in canonical form
 * (parsed, object keys sorted, no incidental whitespace), so the same call formatted two
 * different ways — which models do freely — is recognized as the same call. Arguments
 * that don't parse as JSON fall back to the trimmed raw string; a malformed call is
 * still worth detecting when it repeats.
 */
export function toolCallSignature(name: string, rawArgs: string): string {
  return `${name}:${canonicalizeArgs(rawArgs)}`;
}

function canonicalizeArgs(rawArgs: string): string {
  const trimmed = rawArgs.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(sortKeys(JSON.parse(trimmed)));
  } catch {
    return trimmed;
  }
}

/** Recursively rebuild objects with their keys in sorted order (arrays keep their order). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}
