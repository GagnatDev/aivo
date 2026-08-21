import type { DigestFailureKind } from "../db/schema.enums.js";
import { LlmProviderError } from "../llm/errors.js";
import { YoutubeApiError } from "../youtube/errors.js";

/**
 * Turning a thrown error into what a failed digest run records about itself. Pure and
 * unit-tested: the pipeline persists the result on the `digests` row, the Discord layer
 * picks a message from the kind (discord/digestDelivery.ts), and the dashboard shows the
 * message so the owner never has to open the pod log to learn what broke.
 */
export interface DigestFailure {
  kind: DigestFailureKind;
  /** Human-readable detail, shown verbatim in Discord and on the dashboard. */
  message: string;
}

/** How much of an error message we keep — enough to be useful, short enough to render. */
const MAX_MESSAGE_CHARS = 300;

export function classifyDigestFailure(err: unknown): DigestFailure {
  const message = truncate(errorMessage(err));
  if (err instanceof YoutubeApiError) {
    return { kind: err.kind === "auth" ? "youtube_auth" : "youtube_api", message };
  }
  if (err instanceof LlmProviderError) return { kind: "llm", message };
  return { kind: "unknown", message };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === "string" && err.trim()) return err.trim();
  return "unknown error";
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_CHARS
    ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…`
    : message;
}
