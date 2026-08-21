import { describeFailure, type DigestFailure } from "../../lib/digests.js";

/**
 * Why the run failed, in one line: a plain-language headline for the failure kind plus
 * the reason the backend recorded (#83 — the owner shouldn't have to read the pod log to
 * learn that the YouTube token expired). Renders nothing for a run that didn't fail.
 */
export function DigestFailureNote({ failure }: { failure: DigestFailure | null }) {
  const described = describeFailure(failure);
  if (!described) return null;
  return (
    <p className="digest-failure-note" role="status">
      <span aria-hidden="true">✕</span> {described}
    </p>
  );
}
