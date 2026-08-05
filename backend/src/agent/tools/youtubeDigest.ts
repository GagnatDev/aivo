import { z } from "zod";
import { parseDigestLane, withDigestLane } from "../../digest/proactivity.js";
import { OWNER_ONLY, parse, type AgentTool, type ToolContext } from "./index.js";

/**
 * The chat control surface for the YouTube daily digest: inspect status, configure the
 * schedule (hour / every-N-days interval / pick cap), pause or turn it off, resume,
 * trigger a run now, edit the interest profile, mute channels, and record freeform
 * feedback. The digest is owner-scoped (docs/data-model.md), so every mutating action
 * is owner-only — enforced here, never via prompt text.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const digestArgs = z.object({
  action: z.enum([
    "status",
    "configure",
    "pause",
    "resume",
    "run_now",
    "resync_subscriptions",
    "set_interests",
    "show_more_picks",
    "record_feedback",
    "mute_channel",
    "unmute_channel",
  ]),
  digest_hour: z.number().int().min(0).max(23).optional(),
  digest_interval_days: z.number().int().min(1).max(30).optional(),
  digest_cap: z.number().int().min(1).max(15).optional(),
  pause_days: z.number().positive().max(365).optional(),
  pause_until: z.string().optional(),
  interests: z.string().min(1).optional(),
  feedback: z.string().min(1).optional(),
  channel_title: z.string().min(1).optional(),
});

type DigestArgs = z.infer<typeof digestArgs>;

export const youtubeDigestTool: AgentTool = {
  // Bilingual keyword gate (English + Norwegian, the owner's usual language) — see
  // reminders.ts and gate.ts.
  gate: [
    "youtube",
    "digest",
    "video",
    "interest",
    "interesse",
    "subscription",
    "pick",
    "channel",
    "kanal",
    "abonnement",
    "sammendrag",
  ],
  schema: {
    name: "youtube_digest",
    description:
      "Manage the YouTube daily digest. Call this when the conversation is about the digest " +
      "or its videos/picks/channels/interests — checking or changing the schedule, pausing " +
      "('pause the digest', 'stopp sammendraget'), asking for more picks ('vis flere videoer'), " +
      "muting a channel ('demp den kanalen'), or giving digest feedback. " +
      "Actions: 'status' (schedule, pause state, last run); " +
      "'configure' (digest_hour 0-23, digest_interval_days 1=daily/7=weekly, digest_cap picks " +
      "per digest); 'pause' (temporarily off — pause_days or pause_until date; neither = off " +
      "until resumed); 'resume' (turn back on); 'run_now' (deliver a digest within a minute); " +
      "'resync_subscriptions' (force a full re-sync of the subscribed-channel list, then run " +
      "now — use when the connected YouTube account changed, e.g. the refresh token was swapped, " +
      "and the digest finds no channels); " +
      "'set_interests' (replace the interest profile with the interests text); " +
      "'show_more_picks' (lower-confidence picks from the latest digest); 'record_feedback' " +
      "(freeform digest feedback to fold into the profile); 'mute_channel'/'unmute_channel' " +
      "(channel_title: stop/resume showing a channel). All actions except status, " +
      "show_more_picks, and record_feedback are OWNER-ONLY.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "configure",
            "pause",
            "resume",
            "run_now",
            "resync_subscriptions",
            "set_interests",
            "show_more_picks",
            "record_feedback",
            "mute_channel",
            "unmute_channel",
          ],
        },
        digest_hour: { type: "integer", description: "local hour 0-23 to deliver at" },
        digest_interval_days: {
          type: "integer",
          description: "run every N days (1 = daily, 7 = weekly)",
        },
        digest_cap: { type: "integer", description: "max ranked picks per digest (1-15)" },
        pause_days: { type: "number", description: "pause for this many days from now" },
        pause_until: { type: "string", description: "pause until this date (YYYY-MM-DD)" },
        interests: { type: "string", description: "the full interest profile text" },
        feedback: { type: "string", description: "freeform feedback to record" },
        channel_title: { type: "string", description: "channel to mute/unmute" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(digestArgs, args);
    if (!p.ok) return p.error;
    const a = p.value;

    if (a.action === "status") return status(ctx);
    if (a.action === "show_more_picks") return showMorePicks(ctx);
    if (a.action === "record_feedback") {
      if (!a.feedback) return "Provide feedback text.";
      await ctx.deps.feedback.insert({
        userId: ctx.userId,
        signal: "freeform",
        freeformText: a.feedback,
      });
      return "Feedback recorded — it folds into the interest profile at the next digest run.";
    }

    if (!ctx.isOwner) return OWNER_ONLY;
    switch (a.action) {
      case "configure":
        return configure(ctx, a);
      case "pause":
        return pause(ctx, a);
      case "resume":
        return setLane(ctx, { enabled: true, pausedUntil: null }, "Digest resumed.");
      case "run_now":
        return setLane(
          ctx,
          { runRequestedAt: ctx.deps.clock.now() },
          "Digest run requested — it will arrive within a minute.",
        );
      case "resync_subscriptions":
        // Clear the sync watermarks so the next ingest refetches the full subscription
        // list (bypassing the 20h throttle) and polls videos over the digest look-back,
        // then arm a run to do it now.
        await ctx.deps.youtubeAccount.resetSyncWatermarks();
        return setLane(
          ctx,
          { runRequestedAt: ctx.deps.clock.now() },
          "Re-syncing your YouTube subscriptions and running a digest now — it will arrive " +
            "within a minute.",
        );
      case "set_interests": {
        if (!a.interests) return "Provide the interests text.";
        const profile = await ctx.deps.profiles.setCurrent(
          ctx.userId,
          "youtube_interest",
          a.interests,
        );
        return `Interest profile updated (v${profile.version}).`;
      }
      case "mute_channel":
      case "unmute_channel": {
        if (!a.channel_title) return "Provide channel_title.";
        const muted = a.action === "mute_channel";
        const row = await ctx.deps.youtubeChannels.findByTitle(a.channel_title);
        if (!row) return `I don't know a subscribed channel called "${a.channel_title}".`;
        await ctx.deps.youtubeChannels.setMuted(row.id, muted);
        return muted
          ? `Muted "${row.title}" — its videos are skipped from now on.`
          : `Unmuted "${row.title}".`;
      }
    }
  },
};

async function status(ctx: ToolContext): Promise<string> {
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  const lane = parseDigestLane(settings.proactivity);
  const latest = await ctx.deps.digests.latestForUser(ctx.userId);
  const profile = await ctx.deps.profiles.getCurrent(ctx.userId, "youtube_interest");
  const now = ctx.deps.clock.now();
  const paused = lane.pausedUntil && lane.pausedUntil > now;
  return JSON.stringify({
    enabled: lane.enabled,
    paused_until: paused ? lane.pausedUntil?.toISOString() : null,
    delivery_hour_local: settings.digest_hour,
    interval_days: settings.digest_interval_days,
    picks_cap: settings.digest_cap,
    timezone: settings.timezone,
    last_run: latest
      ? {
          date: latest.run_date,
          status: latest.status,
          // So "why didn't the digest arrive?" is answerable from chat, not the pod log.
          failure: latest.failure_kind
            ? { kind: latest.failure_kind, detail: latest.failure_message }
            : null,
        }
      : null,
    interest_profile: profile ? `v${profile.version}` : "not set up yet",
  });
}

async function showMorePicks(ctx: ToolContext): Promise<string> {
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  const latest = await ctx.deps.digests.latestForUser(ctx.userId);
  if (!latest) return "No digest has run yet.";
  const items = await ctx.deps.digestItems.listByDigest(latest.id);
  const overflow = items.filter(
    (i) => i.kind === "pick" && i.rank !== null && i.rank > settings.digest_cap,
  );
  if (overflow.length === 0) return "No further picks in the latest digest.";
  const videos = await ctx.deps.videos.findByIds(overflow.map((i) => i.video_id));
  const byId = new Map(videos.map((v) => [v.id, v]));
  const now = ctx.deps.clock.now().getTime();
  const lines = overflow.map((i) => {
    const v = byId.get(i.video_id);
    const releaseNote =
      v && v.published_at.getTime() > now
        ? ` [not released yet — releases ${v.published_at.toISOString()}]`
        : "";
    return `${i.rank}. ${v?.title ?? i.video_id} — https://www.youtube.com/watch?v=${i.video_id}${releaseNote}${v?.why ? ` (${v.why})` : ""}`;
  });
  return `Lower-confidence picks from ${latest.run_date}:\n${lines.join("\n")}`;
}

async function configure(ctx: ToolContext, a: DigestArgs): Promise<string> {
  const patch: Record<string, number> = {};
  if (a.digest_hour !== undefined) patch.digest_hour = a.digest_hour;
  if (a.digest_interval_days !== undefined) patch.digest_interval_days = a.digest_interval_days;
  if (a.digest_cap !== undefined) patch.digest_cap = a.digest_cap;
  if (Object.keys(patch).length === 0) {
    return "Provide digest_hour, digest_interval_days, and/or digest_cap.";
  }
  const row = await ctx.deps.settings.update(ctx.userId, patch);
  const cadence =
    row.digest_interval_days === 1 ? "daily" : `every ${row.digest_interval_days} days`;
  return `Digest schedule updated: ${cadence} at ${row.digest_hour}:00 ${row.timezone}, up to ${row.digest_cap} picks.`;
}

async function pause(ctx: ToolContext, a: DigestArgs): Promise<string> {
  const now = ctx.deps.clock.now();
  if (a.pause_until) {
    const until = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(a.pause_until) ? `${a.pause_until}T00:00:00Z` : a.pause_until,
    );
    if (Number.isNaN(until.getTime())) return "I couldn't parse pause_until — use YYYY-MM-DD.";
    if (until <= now) return "That pause date is in the past.";
    return setLane(
      ctx,
      { pausedUntil: until },
      `Digest paused until ${until.toISOString().slice(0, 10)}.`,
    );
  }
  if (a.pause_days) {
    const until = new Date(now.getTime() + a.pause_days * DAY_MS);
    return setLane(
      ctx,
      { pausedUntil: until },
      `Digest paused for ${a.pause_days} day${a.pause_days === 1 ? "" : "s"} (until ${until.toISOString().slice(0, 10)}).`,
    );
  }
  return setLane(
    ctx,
    { enabled: false, pausedUntil: null },
    'Digest turned off. Say "resume the digest" to turn it back on.',
  );
}

async function setLane(
  ctx: ToolContext,
  patch: Parameters<typeof withDigestLane>[1],
  reply: string,
): Promise<string> {
  const settings = await ctx.deps.settings.getOrCreate(ctx.userId);
  await ctx.deps.settings.update(ctx.userId, {
    proactivity: withDigestLane(settings.proactivity, patch),
  });
  return reply;
}
