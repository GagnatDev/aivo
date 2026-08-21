import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYoutubeDataApi,
  parseApiInstant,
  parseIso8601Duration,
  uploadsPlaylistId,
} from "./api.js";

describe("parseIso8601Duration", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT15M")).toBe(900);
    expect(parseIso8601Duration("PT45S")).toBe(45);
    expect(parseIso8601Duration("P1DT1S")).toBe(86_401);
  });

  it("returns null for missing or degenerate input", () => {
    expect(parseIso8601Duration(undefined)).toBeNull();
    expect(parseIso8601Duration("P0D")).toBeNull(); // live streams
    expect(parseIso8601Duration("garbage")).toBeNull();
  });
});

describe("uploadsPlaylistId", () => {
  it("maps a UC channel id to its UU uploads playlist", () => {
    expect(uploadsPlaylistId("UCabc123")).toBe("UUabc123");
  });

  it("passes through non-UC ids unchanged", () => {
    expect(uploadsPlaylistId("HCxyz")).toBe("HCxyz");
  });
});

describe("parseApiInstant", () => {
  it("parses an API timestamp", () => {
    expect(parseApiInstant("2026-08-06T16:00:00Z")).toEqual(new Date("2026-08-06T16:00:00Z"));
  });

  it("returns null for missing or unparsable input", () => {
    expect(parseApiInstant(undefined)).toBeNull();
    expect(parseApiInstant("")).toBeNull();
    expect(parseApiInstant("not a date")).toBeNull();
  });
});

/**
 * The one network-shaped case worth pinning down here: what the client makes of an
 * upcoming premiere. YouTube lists it in the uploads playlist as soon as it is announced,
 * so `videoPublishedAt` is already past — only `liveStreamingDetails` says when it airs,
 * and without that the digest cannot tell it apart from a video that is out.
 */
describe("createYoutubeDataApi.listNewVideos", () => {
  const playlistItem = (id: string, publishedAt: string) => ({
    snippet: { title: `Video ${id}`, description: "d", thumbnails: { medium: { url: "t.jpg" } } },
    contentDetails: { videoId: id, videoPublishedAt: publishedAt },
  });

  function stubFetch(videoItems: unknown[]): void {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Response.json({ access_token: "at", expires_in: 3600 });
      }
      if (url.includes("/playlistItems")) {
        return Response.json({
          items: [
            playlistItem("out", "2026-08-04T10:00:00Z"),
            playlistItem("premiere", "2026-08-04T11:00:00Z"),
          ],
        });
      }
      return Response.json({ items: videoItems });
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const api = () =>
    createYoutubeDataApi({ clientId: "c", clientSecret: "s", refreshToken: "r" }).listNewVideos(
      ["UC1"],
      new Date("2026-08-01T00:00:00Z"),
    );

  it("takes an upcoming premiere's release instant from liveStreamingDetails", async () => {
    stubFetch([
      { id: "out", contentDetails: { duration: "PT15M" } },
      {
        id: "premiere",
        contentDetails: { duration: "P0D" },
        liveStreamingDetails: { scheduledStartTime: "2026-08-06T16:00:00Z" },
      },
    ]);
    const videos = await api();
    expect(videos.map((v) => [v.id, v.scheduledStartTime])).toEqual([
      ["out", null],
      ["premiere", new Date("2026-08-06T16:00:00Z")],
    ]);
    expect(videos[0].durationSeconds).toBe(900);
  });

  it("prefers the actual start of a stream that already began", async () => {
    stubFetch([
      { id: "out", contentDetails: { duration: "PT15M" } },
      {
        id: "premiere",
        liveStreamingDetails: {
          scheduledStartTime: "2026-08-06T16:00:00Z",
          actualStartTime: "2026-08-06T16:07:00Z",
        },
      },
    ]);
    const videos = await api();
    expect(videos[1].scheduledStartTime).toEqual(new Date("2026-08-06T16:07:00Z"));
  });

  it("leaves the release instant null when the video resource is missing", async () => {
    stubFetch([]);
    const videos = await api();
    expect(videos.map((v) => v.scheduledStartTime)).toEqual([null, null]);
    expect(videos.map((v) => v.durationSeconds)).toEqual([null, null]);
  });
});
