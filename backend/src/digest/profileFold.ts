import type { ChatMessage } from "../llm/provider.js";

/**
 * Folding accumulated feedback into the interest profile — the learning half of the
 * digest loop (docs/concept.md: buttons + freeform replies both fold into the
 * profile). Pure prompt building; the pipeline runs the call at the start of each run
 * and versions the profile via ProfileRepository.setCurrent.
 */

export interface FeedbackLine {
  /** keep | drop | too_long | wrong_topic | freeform */
  signal: string;
  /** "Title — Channel" when the feedback was about one digest entry. */
  videoLabel: string | null;
  freeformText: string | null;
}

export function buildProfileFoldMessages(
  currentProfile: string,
  feedback: FeedbackLine[],
): ChatMessage[] {
  const lines = feedback.map((f) => {
    const target = f.videoLabel ? ` on "${f.videoLabel}"` : "";
    return f.signal === "freeform"
      ? `- said${target}: ${f.freeformText ?? ""}`
      : `- reacted "${f.signal.replace("_", " ")}"${target}`;
  });
  return [
    {
      role: "system",
      content:
        "You maintain the user's YouTube interest profile for a daily digest. Fold the new " +
        "feedback into the profile: strengthen confirmed interests, add explicit dislikes " +
        '("keep" = the pick was right, "drop"/"wrong topic"/"too long" = it was not), and keep ' +
        "everything else. The profile is short, human-readable prose the user can inspect and " +
        "edit — no headings, no JSON. Respond with ONLY the full revised profile text.",
    },
    {
      role: "user",
      content: `Current profile:\n${currentProfile}\n\nNew feedback:\n${lines.join("\n")}`,
    },
  ];
}

/** The revised profile from the model's text, or undefined when unusable. */
export function parseProfileFoldResponse(text: string | null): string | undefined {
  const body = text?.trim();
  return body ? body : undefined;
}
