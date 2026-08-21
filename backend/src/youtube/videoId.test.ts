import { describe, expect, it } from "vitest";
import { parseYoutubeVideoId } from "./videoId.js";

const ID = "dQw4w9WgXcQ";

describe("parseYoutubeVideoId", () => {
  it.each([
    ["bare id", ID],
    ["bare id with whitespace", `  ${ID} `],
    ["watch URL", `https://www.youtube.com/watch?v=${ID}`],
    ["watch URL with extra params", `https://www.youtube.com/watch?v=${ID}&t=42s&list=PLx`],
    ["watch URL with v not first", `https://www.youtube.com/watch?list=PLx&v=${ID}`],
    ["schemeless watch URL", `youtube.com/watch?v=${ID}`],
    ["mobile host", `https://m.youtube.com/watch?v=${ID}`],
    ["music host", `https://music.youtube.com/watch?v=${ID}`],
    ["short link", `https://youtu.be/${ID}`],
    ["short link with timestamp", `https://youtu.be/${ID}?t=30`],
    ["schemeless short link", `youtu.be/${ID}`],
    ["shorts path", `https://www.youtube.com/shorts/${ID}`],
    ["live path", `https://www.youtube.com/live/${ID}?feature=share`],
    ["embed path", `https://www.youtube.com/embed/${ID}`],
    ["legacy /v/ path", `https://www.youtube.com/v/${ID}`],
  ])("extracts the id from a %s", (_label, input) => {
    expect(parseYoutubeVideoId(input)).toBe(ID);
  });

  it.each([
    ["free text", "summarize the video about rockets"],
    ["a too-short id", "abc123"],
    ["a too-long id-like string", "dQw4w9WgXcQdQw4w9WgXcQ"],
    ["a non-YouTube URL", `https://vimeo.com/watch?v=${ID}`],
    ["a lookalike host", `https://notyoutube.com/watch?v=${ID}`],
    ["a channel URL", "https://www.youtube.com/@somechannel"],
    ["a watch URL with a malformed id", "https://www.youtube.com/watch?v=nope"],
    ["an empty string", ""],
  ])("returns null for %s", (_label, input) => {
    expect(parseYoutubeVideoId(input)).toBeNull();
  });
});
