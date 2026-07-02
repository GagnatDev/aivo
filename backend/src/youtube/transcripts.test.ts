import { describe, expect, it } from "vitest";
import { extractCaptionTracks, pickCaptionTrack, timedTextToPlain } from "./transcripts.js";

describe("pickCaptionTrack", () => {
  it("prefers human tracks over auto-generated and English within each class", () => {
    const asrEn = { baseUrl: "u1", languageCode: "en", kind: "asr" };
    const humanNo = { baseUrl: "u2", languageCode: "no" };
    const humanEn = { baseUrl: "u3", languageCode: "en" };
    expect(pickCaptionTrack([asrEn, humanNo, humanEn])).toBe(humanEn);
    expect(pickCaptionTrack([asrEn, humanNo])).toBe(humanNo);
    expect(pickCaptionTrack([asrEn])).toBe(asrEn);
  });

  it("ignores tracks without a baseUrl and handles empty lists", () => {
    expect(pickCaptionTrack([{ languageCode: "en" }])).toBeUndefined();
    expect(pickCaptionTrack([])).toBeUndefined();
  });
});

describe("timedTextToPlain", () => {
  it("joins text nodes, strips markup, and decodes entities", () => {
    const xml =
      '<?xml version="1.0"?><transcript>' +
      '<text start="0" dur="2">Hello &amp; welcome</text>' +
      '<text start="2" dur="2">to <i>the</i> show &#39;26</text>' +
      "</transcript>";
    expect(timedTextToPlain(xml)).toBe("Hello & welcome to the show '26");
  });
});

describe("extractCaptionTracks", () => {
  it("pulls the captionTracks array out of a watch page", () => {
    const html =
      'blah "captions":{"playerCaptionsTracklistRenderer":{"captionTracks":' +
      '[{"baseUrl":"https://example.test/tt","languageCode":"en","kind":"asr"}],"other":1}} more';
    const tracks = extractCaptionTracks(html);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].baseUrl).toBe("https://example.test/tt");
  });

  it("returns empty for pages without captions or with broken JSON", () => {
    expect(extractCaptionTracks("<html>no captions</html>")).toEqual([]);
    expect(extractCaptionTracks('"captionTracks":[{"broken":')).toEqual([]);
  });
});
