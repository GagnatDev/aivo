import { describe, expect, it } from "vitest";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeFakeYoutube } from "../test/fakeYoutube.js";
import { tokenRefreshError } from "../youtube/errors.js";
import { runDigest } from "./pipeline.js";

useCleanDb();

const NOW = new Date("2026-07-01T05:00:00Z");

const SUBSCRIPTIONS = [
  { id: "UC1", title: "Wood", thumbnailUrl: null },
  { id: "UC2", title: "News", thumbnailUrl: null },
];

const uploaded = (id: string, channelId: string, title: string) => ({
  id,
  channelId,
  title,
  description: `about ${title}`,
  publishedAt: new Date("2026-06-30T18:00:00Z"),
  thumbnailUrl: `https://i.ytimg.com/${id}.jpg`,
  durationSeconds: 900,
});

async function setupOwner(llmScript: Parameters<typeof makeFakeLlm>[0]) {
  const deps = makeAgentDeps(makeFakeLlm(llmScript), {}, new FakeClock(NOW));
  const { userId } = await provisionUser(deps, OWNER_ID);
  return { deps, userId };
}

describe("runDigest", () => {
  it("runs the two-stage filter and returns ranked picks + tapered rejects", async () => {
    const stage1 =
      '[{"id":"v1","score":0.9},{"id":"v2","score":0.8},' +
      '{"id":"v3","score":0.1,"reason":"news recap, you said no"}]';
    const pick =
      '{"decision":"pick","confidence":0.9,"summary":["half-blind dovetails","tool list"],"why":"hand-tool joinery is your thing"}';
    const reject = '{"decision":"reject","confidence":0.6,"reason":"mostly product ads"}';
    const { deps, userId } = await setupOwner([
      textResult(stage1),
      textResult(pick),
      textResult(reject),
    ]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "likes hand-tool woodworking");

    const yt = makeFakeYoutube({
      subscriptions: SUBSCRIPTIONS,
      videos: [
        uploaded("v1", "UC1", "Dovetails by hand"),
        uploaded("v2", "UC1", "Best routers 2026"),
        uploaded("v3", "UC2", "Weekly news recap"),
      ],
      transcripts: { v1: "long transcript about dovetails" },
    });
    const outcome = await runDigest(deps, yt, userId, NOW);

    expect(outcome.kind).toBe("digest");
    if (outcome.kind !== "digest") throw new Error("unreachable");
    expect(outcome.picks).toHaveLength(1);
    expect(outcome.picks[0]).toMatchObject({
      videoId: "v1",
      rank: 1,
      channelTitle: "Wood",
      url: "https://www.youtube.com/watch?v=v1",
      summaryBullets: ["half-blind dovetails", "tool list"],
      why: "hand-tool joinery is your thing",
    });
    // Cold start: both the stage-2 reject and the stage-1 near-miss are shown.
    expect(outcome.rejects).toEqual([
      { title: "Best routers 2026", channelTitle: "Wood", reason: "mostly product ads" },
      { title: "Weekly news recap", channelTitle: "News", reason: "news recap, you said no" },
    ]);

    // Persistence: items stored (all rejects, even beyond the delivered slice),
    // stage results on videos, watermarks advanced.
    const digest = await deps.digests.latestForUser(userId);
    expect(digest?.status).toBe("pending"); // delivery marks it
    const items = await deps.digestItems.listByDigest(outcome.digestId);
    expect(items.filter((i) => i.kind === "pick")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "reject")).toHaveLength(2);
    const [v1] = await deps.videos.findByIds(["v1"]);
    expect(v1.stage2_decision).toBe("pick");
    expect(v1.transcript_status).toBe("fetched");
    const [v2] = await deps.videos.findByIds(["v2"]);
    expect(v2.transcript_status).toBe("unavailable");
    expect((await deps.youtubeAccount.getOrCreate()).videos_polled_at).not.toBeNull();
    // Metered under the digest task types, cost attributed to the run.
    expect(Number(digest?.cost_cents)).toBeGreaterThan(0);
  });

  it("skips the run without any LLM spend when proactive work is budget-paused", async () => {
    const { deps, userId } = await setupOwner([]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "anything");
    // 95% of the (default 1500¢) ceiling → proactive_paused.
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "m",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1425,
    });
    const outcome = await runDigest(deps, makeFakeYoutube(), userId, NOW);
    expect(outcome.kind).toBe("skipped_budget");
    expect((await deps.digests.latestForUser(userId))?.status).toBe("skipped_budget");
  });

  it("returns no_profile (and still watermarks the day) when interests are unset", async () => {
    const { deps, userId } = await setupOwner([]);
    const outcome = await runDigest(deps, makeFakeYoutube(), userId, NOW);
    expect(outcome.kind).toBe("no_profile");
    expect((await deps.digests.latestForUser(userId))?.run_date).toBe("2026-07-01");
  });

  it("folds pending feedback into a new profile version before ranking", async () => {
    const { deps, userId } = await setupOwner([
      textResult("likes hand-tool woodworking; no shorts from any channel"),
    ]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "likes hand-tool woodworking");
    await deps.feedback.insert({ userId, signal: "freeform", freeformText: "stop showing shorts" });

    const outcome = await runDigest(deps, makeFakeYoutube({ subscriptions: [] }), userId, NOW);
    expect(outcome.kind).toBe("digest");
    const profile = await deps.profiles.getCurrent(userId, "youtube_interest");
    expect(profile?.version).toBe(2);
    expect(profile?.body).toMatch(/no shorts/);
    expect(await deps.feedback.listUnapplied(userId)).toHaveLength(0);
  });

  it("marks the run failed with the reason when the OAuth refresh token is dead (#83)", async () => {
    const { deps, userId } = await setupOwner([]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "anything");
    const yt = makeFakeYoutube();
    yt.api.listSubscriptions = () => {
      throw tokenRefreshError(
        400,
        '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
      );
    };

    const outcome = await runDigest(deps, yt, userId, NOW);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.failure.kind).toBe("youtube_auth");
    expect(outcome.failure.message).toContain("invalid_grant");
    const digest = await deps.digests.latestForUser(userId);
    expect(digest?.status).toBe("failed");
    expect(digest?.failure_kind).toBe("youtube_auth");
    expect(digest?.failure_message).toContain("invalid_grant");
    expect(digest?.delivered_at).toBeNull();
  });

  it("records the partial spend of a run that fails after paying for stage 1", async () => {
    const { deps, userId } = await setupOwner([textResult('[{"id":"v1","score":0.9}]')]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "anything");
    const yt = makeFakeYoutube({
      subscriptions: SUBSCRIPTIONS,
      videos: [uploaded("v1", "UC1", "Dovetails by hand")],
    });
    // The transcript fetch is the first thing stage 2 does — fail it to abort the run
    // once stage 1 has already been billed.
    yt.transcripts.fetchTranscript = () => {
      throw new Error("transcript service unreachable");
    };

    const outcome = await runDigest(deps, yt, userId, NOW);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.failure).toEqual({ kind: "unknown", message: "transcript service unreachable" });
    const digest = await deps.digests.latestForUser(userId);
    expect(digest?.status).toBe("failed");
    expect(Number(digest?.cost_cents)).toBeGreaterThan(0);
  });

  it("returns an empty digest when nothing new was published", async () => {
    const { deps, userId } = await setupOwner([]);
    await deps.profiles.setCurrent(userId, "youtube_interest", "anything");
    const outcome = await runDigest(
      deps,
      makeFakeYoutube({ subscriptions: SUBSCRIPTIONS }),
      userId,
      NOW,
    );
    expect(outcome.kind).toBe("digest");
    if (outcome.kind !== "digest") throw new Error("unreachable");
    expect(outcome.picks).toHaveLength(0);
    expect(outcome.rejects).toHaveLength(0);
  });
});
