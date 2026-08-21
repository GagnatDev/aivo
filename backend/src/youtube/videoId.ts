/**
 * Extract the 11-character video id from whatever a user pastes: a bare id, a
 * youtube.com/watch?v= URL, a youtu.be short link, or a shorts/live/embed path.
 * Pure string parsing; returns null when no id can be found so the caller can
 * phrase the error for its audience.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeVideoId(input: string): string | null {
  const text = input.trim();
  if (ID_PATTERN.test(text)) return text;

  let url: URL;
  try {
    // Users paste links without a scheme ("youtube.com/watch?v=…") often enough
    // that URL() rejecting them outright would be a needless failure.
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") return idOrNull(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;

  const fromQuery = url.searchParams.get("v");
  if (fromQuery) return idOrNull(fromQuery);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "live", "embed", "v"].includes(segments[0])) {
    return idOrNull(segments[1]);
  }
  return null;
}

function idOrNull(candidate: string | undefined): string | null {
  return candidate && ID_PATTERN.test(candidate) ? candidate : null;
}
