import { loadBudgetSnapshot, preCallCheck, recordUsageAndAlert } from "../agent/budget.js";
import type { AgentDeps } from "../agent/deps.js";
import { resolveModel } from "../agent/modelSelection.js";
import { asLanguage, type Language, messages } from "../i18n/index.js";
import { logger } from "../logger.js";
import type { SettingsRow } from "../storage/settingsRepository.js";
import type { VideoRow } from "../storage/videoRepository.js";
import type { YoutubeApi } from "../youtube/api.js";
import type { TranscriptSource } from "../youtube/transcripts.js";
import { localDate } from "./due.js";
import { classifyDigestFailure, type DigestFailure } from "./failure.js";
import { ingestNewVideos } from "./ingest.js";
import { buildProfileFoldMessages, parseProfileFoldResponse } from "./profileFold.js";
import { buildStage1Messages, parseStage1Response } from "./rank.js";
import { buildStage2Messages, parseStage2Response, type Stage2Verdict } from "./summarize.js";
import { rejectedListLimit } from "./taper.js";

/** The network-facing integrations the pipeline needs beyond AgentDeps. */
export interface YoutubeIntegrations {
  api: YoutubeApi;
  transcripts: TranscriptSource;
}

export interface DeliverablePick {
  itemId: string;
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  summaryBullets: string[];
  why: string;
  rank: number;
}

export interface DeliverableReject {
  title: string;
  channelTitle: string;
  reason: string;
}

export type DigestOutcome =
  | { kind: "skipped_budget"; digestId: string }
  | { kind: "no_profile"; digestId: string }
  /** The run threw; the `digests` row is `failed` and carries this reason. */
  | { kind: "failed"; digestId: string; failure: DigestFailure }
  | {
      kind: "digest";
      digestId: string;
      runDate: string;
      picks: DeliverablePick[];
      /** Picks beyond the delivered cap ("N more matched, lower confidence"). */
      morePicksCount: number;
      rejects: DeliverableReject[];
      /** Set when a budget alert threshold was newly crossed during the run. */
      alertPct?: number;
    };

// Volume guards (docs/concept.md): bound the stage-1 prompt and the number of
// transcripts that get expensive stage-2 treatment.
const MAX_CANDIDATES = 40;
const STAGE2_EXTRA = 4; // shortlist = cap + this, so rejects exist to calibrate on
const STAGE1_FLOOR = 0.3;
const STAGE1_REJECTS_SHOWN = 3;
const AGREEMENT_WINDOW_DAYS = 14;

/** What the run has spent so far — shared with the failure path so a partial run's cost
 * is still recorded on the digests row. */
interface Spend {
  costCents: number;
  alertPct?: number;
}

/**
 * One digest run: fold pending feedback into the profile, ingest new videos from
 * subscriptions, run the two-stage filter, and persist the digest + items. The digests
 * row is created (pending) BEFORE any paid work so a crash can't re-spend the same day;
 * the caller delivers the returned outcome and marks the digest delivered. Owner-scoped
 * by design — `userId` must be the is_owner user (the scheduler and the owner-gated
 * tool both guarantee this).
 *
 * Never throws. A failing phase (an expired YouTube refresh token, a dead provider)
 * becomes a `failed` outcome with the reason persisted on the row and returned for the
 * deliverer to report — previously such a run threw past the scheduler and left its row
 * `pending` forever, with the cause only in the pod log.
 */
export async function runDigest(
  deps: AgentDeps,
  yt: YoutubeIntegrations,
  userId: string,
  now: Date,
): Promise<DigestOutcome> {
  const settings = await deps.settings.getOrCreate(userId);
  const latest = await deps.digests.latestForUser(userId);
  const coversSince =
    latest?.created_at ??
    new Date(now.getTime() - settings.digest_interval_days * 24 * 60 * 60 * 1000);
  const digest = await deps.digests.create({
    userId,
    runDate: localDate(now, settings.timezone),
    coversSince,
  });
  const spend: Spend = { costCents: 0 };

  try {
    return await buildDigest(deps, yt, { userId, now, settings, coversSince, digest, spend });
  } catch (err) {
    const failure = classifyDigestFailure(err);
    logger.error({ err, userId, digestId: digest.id, failure: failure.kind }, "digest run failed");
    // Record what the aborted run already spent before marking it failed, so the
    // dashboard's per-run cost stays honest.
    await deps.digests.setCostCents(digest.id, spend.costCents);
    await deps.digests.markFailed(digest.id, failure);
    return { kind: "failed", digestId: digest.id, failure };
  }
}

/** The run itself, once its `digests` row exists. Throws; `runDigest` classifies. */
async function buildDigest(
  deps: AgentDeps,
  yt: YoutubeIntegrations,
  run: {
    userId: string;
    now: Date;
    settings: SettingsRow;
    coversSince: Date;
    digest: { id: string; run_date: string };
    spend: Spend;
  },
): Promise<DigestOutcome> {
  const { userId, now, settings, coversSince, digest, spend } = run;

  // Graceful degradation stage 2+: proactive work pauses, chat keeps answering.
  const snapshot = await loadBudgetSnapshot(deps, userId);
  if (snapshot.state === "proactive_paused" || snapshot.state === "over_ceiling") {
    await deps.digests.setStatus(digest.id, "skipped_budget");
    return { kind: "skipped_budget", digestId: digest.id };
  }

  const profile = await deps.profiles.getCurrent(userId, "youtube_interest");
  if (!profile) {
    // The caller delivers an onboarding nudge instead of a digest; the pending row
    // created above still acts as today's watermark, so the nudge fires at most once
    // per interval.
    return { kind: "no_profile", digestId: digest.id };
  }

  const meter = (record: { alertPct?: number; costCents: number }): void => {
    spend.costCents += record.costCents;
    if (record.alertPct) spend.alertPct = Math.max(spend.alertPct ?? 0, record.alertPct);
  };

  const language = asLanguage(settings.language);
  const m = messages(language);
  const profileBody = await foldPendingFeedback(deps, userId, profile.body, language, meter);

  await ingestNewVideos(deps, yt, now, coversSince);
  const candidates = await deps.videos.listCandidatesSince(coversSince, MAX_CANDIDATES);
  const channelTitles = await deps.videos.channelTitles(candidates.map((v) => v.channel_id));
  const label = (v: VideoRow): { title: string; channelTitle: string } => ({
    title: v.title,
    channelTitle: channelTitles.get(v.channel_id) ?? v.channel_id,
  });

  if (candidates.length === 0) {
    await deps.digests.setCostCents(digest.id, spend.costCents);
    return {
      kind: "digest",
      digestId: digest.id,
      runDate: digest.run_date,
      picks: [],
      morePicksCount: 0,
      rejects: [],
      alertPct: spend.alertPct,
    };
  }

  // Stage 1: one cheap-model call ranks all candidate metadata against the profile.
  const stage1Check = await preCallCheck(deps, userId, "cheap");
  const stage1Model = await resolveModel(deps, stage1Check.coercedTier);
  const stage1Result = await deps.llm.chat({
    model: stage1Model,
    messages: buildStage1Messages(
      profileBody,
      candidates.map((v) => ({
        id: v.id,
        title: v.title,
        channelTitle: label(v).channelTitle,
        description: v.description,
        durationSeconds: v.duration_seconds,
      })),
      language,
    ),
    maxTokens: deps.config.llmMaxOutputTokens,
  });
  meter(await recordUsageAndAlert(deps, userId, "stage1_rank", stage1Model, stage1Result.usage));
  const scores = parseStage1Response(
    stage1Result.content,
    candidates.map((v) => v.id),
  ).sort((a, b) => b.score - a.score);
  await deps.videos.saveStage1Scores(scores, now);

  const shortlist = scores
    .filter((s) => s.score >= STAGE1_FLOOR)
    .slice(0, settings.digest_cap + STAGE2_EXTRA);
  const shortlistIds = new Set(shortlist.map((s) => s.id));
  const stage1Rejects = scores
    .filter((s) => !shortlistIds.has(s.id))
    .slice(0, STAGE1_REJECTS_SHOWN);

  // Stage 2: transcript + summary per shortlisted video, premium unless degraded.
  const stage2Check = await preCallCheck(deps, userId, "premium");
  const stage2Model = await resolveModel(deps, stage2Check.coercedTier);
  const brief = stage2Check.coercedTier === "cheap";
  const byId = new Map(candidates.map((v) => [v.id, v]));
  const verdicts: Array<{ video: VideoRow; verdict: Stage2Verdict }> = [];
  for (const scored of shortlist) {
    const video = byId.get(scored.id);
    if (!video) continue;
    const verdict = await runStage2(deps, yt, userId, {
      video,
      channelTitle: label(video).channelTitle,
      profileBody,
      model: stage2Model,
      brief,
      language,
      meter,
    });
    if (verdict) verdicts.push({ video, verdict });
  }

  // Persist items: every pick keeps its rank (overflow is served on request); every
  // reject is stored with its reason, but only the tapered slice is delivered.
  const picks = verdicts
    .filter((v) => v.verdict.decision === "pick")
    .sort((a, b) => b.verdict.confidence - a.verdict.confidence);
  const stage2Rejects = verdicts.filter((v) => v.verdict.decision === "reject");
  const insertedPicks = await deps.digestItems.insertMany(
    digest.id,
    picks.map((p, i) => ({
      videoId: p.video.id,
      kind: "pick" as const,
      rank: i + 1,
      confidence: p.verdict.confidence,
    })),
  );
  await deps.digestItems.insertMany(digest.id, [
    ...stage2Rejects.map((r) => ({
      videoId: r.video.id,
      kind: "reject" as const,
      reason: r.verdict.reason ?? m.digest.reasonNotFit,
      confidence: r.verdict.confidence,
    })),
    ...stage1Rejects.map((s) => ({
      videoId: s.id,
      kind: "reject" as const,
      reason: s.reason ?? m.digest.reasonLowMatch,
      confidence: s.score,
    })),
  ]);
  await deps.digests.setCostCents(digest.id, spend.costCents);

  const stats = await deps.feedback.agreementStats(
    userId,
    new Date(now.getTime() - AGREEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  );
  const rejects: DeliverableReject[] = [
    ...stage2Rejects.map((r) => ({
      ...label(r.video),
      reason: r.verdict.reason ?? m.digest.reasonNotFit,
    })),
    ...stage1Rejects.map((s) => {
      const video = byId.get(s.id);
      return {
        title: video?.title ?? s.id,
        channelTitle: video ? label(video).channelTitle : "",
        reason: s.reason ?? m.digest.reasonLowMatch,
      };
    }),
  ].slice(0, rejectedListLimit(stats));

  return {
    kind: "digest",
    digestId: digest.id,
    runDate: digest.run_date,
    picks: picks.slice(0, settings.digest_cap).map((p, i) => ({
      itemId: insertedPicks[i].id,
      videoId: p.video.id,
      title: p.video.title,
      channelTitle: label(p.video).channelTitle,
      url: `https://www.youtube.com/watch?v=${p.video.id}`,
      durationSeconds: p.video.duration_seconds,
      thumbnailUrl: p.video.thumbnail_url,
      summaryBullets: p.verdict.summaryBullets,
      why: p.verdict.why,
      rank: i + 1,
    })),
    morePicksCount: Math.max(0, picks.length - settings.digest_cap),
    rejects,
    alertPct: spend.alertPct,
  };
}

/** Fold unapplied feedback into the profile; returns the (possibly revised) body. */
async function foldPendingFeedback(
  deps: AgentDeps,
  userId: string,
  currentBody: string,
  language: Language,
  meter: (r: { alertPct?: number; costCents: number }) => void,
): Promise<string> {
  const pending = await deps.feedback.listUnapplied(userId);
  if (pending.length === 0) return currentBody;

  // Resolve "Title — Channel" labels for item-scoped feedback.
  const itemIds = pending.map((f) => f.digest_item_id).filter((id): id is string => id !== null);
  const items = await Promise.all(itemIds.map((id) => deps.digestItems.findById(id)));
  const videoIdByItem = new Map(
    items
      .filter((i): i is NonNullable<typeof i> => i !== undefined)
      .map((i) => [i.id, i.video_id] as const),
  );
  const videos = await deps.videos.findByIds([...new Set(videoIdByItem.values())]);
  const titles = await deps.videos.channelTitles(videos.map((v) => v.channel_id));
  const videoById = new Map(videos.map((v) => [v.id, v]));

  const check = await preCallCheck(deps, userId, "cheap");
  const model = await resolveModel(deps, check.coercedTier);
  const result = await deps.llm.chat({
    model,
    messages: buildProfileFoldMessages(
      currentBody,
      pending.map((f) => {
        const videoId = f.digest_item_id ? videoIdByItem.get(f.digest_item_id) : undefined;
        const video = videoId ? videoById.get(videoId) : undefined;
        return {
          signal: f.signal,
          videoLabel: video
            ? `${video.title} — ${titles.get(video.channel_id) ?? video.channel_id}`
            : null,
          freeformText: f.freeform_text,
        };
      }),
      language,
    ),
    maxTokens: deps.config.llmMaxOutputTokens,
  });
  meter(await recordUsageAndAlert(deps, userId, "profile_update", model, result.usage));

  const revised = parseProfileFoldResponse(result.content);
  if (!revised) {
    logger.warn({ userId }, "profile fold produced no usable text; keeping profile");
    return currentBody;
  }
  await deps.profiles.setCurrent(userId, "youtube_interest", revised);
  await deps.feedback.markApplied(pending.map((f) => f.id));
  return revised;
}

/** One stage-2 call; null when the provider call failed (video skipped this run). */
async function runStage2(
  deps: AgentDeps,
  yt: YoutubeIntegrations,
  userId: string,
  input: {
    video: VideoRow;
    channelTitle: string;
    profileBody: string;
    model: string;
    brief: boolean;
    language: Language;
    meter: (r: { alertPct?: number; costCents: number }) => void;
  },
): Promise<Stage2Verdict | null> {
  const { video } = input;
  const transcript = await yt.transcripts.fetchTranscript(video.id);
  let result: Awaited<ReturnType<typeof deps.llm.chat>>;
  try {
    result = await deps.llm.chat({
      model: input.model,
      messages: buildStage2Messages({
        profileBody: input.profileBody,
        video: {
          title: video.title,
          channelTitle: input.channelTitle,
          description: video.description,
          durationSeconds: video.duration_seconds,
        },
        transcript,
        brief: input.brief,
        language: input.language,
      }),
      maxTokens: deps.config.llmMaxOutputTokens,
    });
  } catch (err) {
    logger.error({ err, videoId: video.id }, "stage-2 call failed; skipping video this run");
    return null;
  }
  input.meter(await recordUsageAndAlert(deps, userId, "stage2_summary", input.model, result.usage));

  // An unusable response degrades to a low-confidence reject rather than aborting.
  const verdict = parseStage2Response(result.content) ?? {
    decision: "reject" as const,
    confidence: 0.2,
    summaryBullets: [],
    why: "",
    reason: messages(input.language).digest.reasonCouldntProcess,
  };
  await deps.videos.saveStage2(video.id, {
    transcriptStatus: transcript ? "fetched" : "unavailable",
    decision: verdict.decision,
    summary: verdict.summaryBullets.map((b) => `- ${b}`).join("\n") || null,
    why: verdict.why || null,
  });
  return verdict;
}
