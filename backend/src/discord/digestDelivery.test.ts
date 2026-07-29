import { describe, expect, it } from "vitest";
import type { DigestOutcome } from "../digest/pipeline.js";
import {
  conversationSummary,
  digestHeader,
  failureNote,
  feedbackButtons,
  pickEmbed,
  rejectedListNote,
} from "./digestDelivery.js";

const pick = {
  itemId: "item-1",
  videoId: "v1",
  title: "Dovetails by hand",
  channelTitle: "Wood",
  url: "https://www.youtube.com/watch?v=v1",
  durationSeconds: 903,
  thumbnailUrl: "https://i.ytimg.com/v1.jpg",
  summaryBullets: ["half-blind dovetails", "tool list"],
  why: "hand-tool joinery is your thing",
  rank: 1,
};

const digestOutcome = (
  overrides: Partial<Extract<DigestOutcome, { kind: "digest" }>> = {},
): Extract<DigestOutcome, { kind: "digest" }> => ({
  kind: "digest",
  digestId: "d1",
  runDate: "2026-07-01",
  picks: [pick],
  morePicksCount: 0,
  rejects: [],
  ...overrides,
});

describe("digestHeader", () => {
  it("announces the pick count and overflow", () => {
    const header = digestHeader(digestOutcome({ morePicksCount: 3 }), "en");
    expect(header).toMatch(/2026-07-01/);
    expect(header).toMatch(/1 pick\b/);
    expect(header).toMatch(/3 more matched/);
  });

  it("celebrates an empty digest and surfaces budget alerts", () => {
    const header = digestHeader(digestOutcome({ picks: [], alertPct: 80 }), "en");
    expect(header).toMatch(/nothing new/);
    expect(header).toMatch(/80%/);
  });

  it("renders the header in Norwegian", () => {
    const header = digestHeader(digestOutcome({ morePicksCount: 3 }), "nb");
    expect(header).toMatch(/1 treff/);
    expect(header).toMatch(/vise flere treff/);
  });
});

describe("pickEmbed", () => {
  it("carries rank, link, TL;DW bullets, why-line, duration, and thumbnail", () => {
    const embed = pickEmbed(pick, "en").toJSON();
    expect(embed.title).toBe("1. Dovetails by hand");
    expect(embed.url).toBe(pick.url);
    expect(embed.description).toContain("• half-blind dovetails");
    expect(embed.description).toContain("*Why: hand-tool joinery is your thing*");
    expect(embed.footer?.text).toBe("15 min · Wood");
    expect(embed.thumbnail?.url).toBe(pick.thumbnailUrl);
  });
});

describe("feedbackButtons", () => {
  it("attaches the four feedback signals keyed to the digest item", () => {
    const row = feedbackButtons("item-1", "en").toJSON();
    const ids = row.components.map((c) => "custom_id" in c && c.custom_id);
    expect(ids).toEqual([
      "fb:keep:item-1",
      "fb:drop:item-1",
      "fb:too_long:item-1",
      "fb:wrong_topic:item-1",
    ]);
  });
});

describe("rejectedListNote", () => {
  it("lists each reject with its one-line reason", () => {
    const note = rejectedListNote(
      [{ title: "Weekly news recap", channelTitle: "News", reason: "news recap, you said no" }],
      "en",
    );
    expect(note).toMatch(/Weekly news recap \(News\) — skipped: news recap, you said no/);
  });
});

describe("failureNote", () => {
  it("tells the owner to reconnect when the YouTube grant is dead, quoting the reason", () => {
    const note = failureNote(
      {
        kind: "youtube_auth",
        message: "YouTube OAuth token refresh failed (400 invalid_grant: Token has been revoked.)",
      },
      "en",
    );
    expect(note).toMatch(/access to your YouTube account has expired/);
    expect(note).toMatch(/invalid_grant/);
    expect(note).toMatch(/Digest History/);
  });

  it("reports any other failure as a retryable one", () => {
    const note = failureNote({ kind: "llm", message: "gateway exploded" }, "en");
    expect(note).toMatch(/couldn't finish today's YouTube digest/);
    expect(note).toMatch(/gateway exploded/);
    expect(note).toMatch(/next scheduled run/);
  });

  it("reports failures in Norwegian too", () => {
    expect(failureNote({ kind: "youtube_auth", message: "invalid_grant" }, "nb")).toMatch(
      /koble den til på nytt/i,
    );
    expect(failureNote({ kind: "youtube_api", message: "quotaExceeded" }, "nb")).toMatch(
      /neste planlagte kjøring/,
    );
  });
});

describe("conversationSummary", () => {
  it("summarizes each outcome kind for the agent's context", () => {
    expect(conversationSummary(digestOutcome())).toMatch(/1\. Dovetails by hand \(Wood\)/);
    expect(conversationSummary({ kind: "no_profile", digestId: "d" })).toMatch(/interest profile/);
    expect(conversationSummary({ kind: "skipped_budget", digestId: "d" })).toMatch(/budget/);
  });

  // The audit row is what surfaces the failure in the dashboard's activity log (#83).
  it("records a failed run with its kind and reason", () => {
    const summary = conversationSummary({
      kind: "failed",
      digestId: "d",
      failure: { kind: "youtube_auth", message: "invalid_grant: Token has been revoked." },
    });
    expect(summary).toMatch(/failed \(youtube_auth\)/);
    expect(summary).toMatch(/Token has been revoked/);
  });
});
