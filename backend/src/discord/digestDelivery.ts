import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
} from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
import type { DigestFailure } from "../digest/failure.js";
import type { DeliverablePick, DeliverableReject, DigestOutcome } from "../digest/pipeline.js";
import { formatReleaseAt, partitionPicks } from "../digest/present.js";
import type { FeedbackSignal } from "../db/schema.enums.js";
import { asLanguage, type Language, messages } from "../i18n/index.js";
import { logger } from "../logger.js";
import type { DigestDeliverer } from "../scheduler/tick.js";
import type { DiscordConfig } from "./config.js";

/**
 * Renders a digest run into #youtube: a header, one embed + feedback-button row per
 * pick (released first, then still-unreleased premieres/scheduled uploads with a clear
 * release time), and a compact rejected list (cold-start calibration). The builders are
 * pure and unit-tested; only the thin send loop touches discord.js. A summary row is
 * persisted to the youtube conversation so the agent has context when the user replies
 * there.
 */

// customId prefix for digest feedback buttons: `fb:<signal>:<digest_item_id>`.
export const FEEDBACK_PREFIX = "fb";
const BUTTON_SIGNALS: readonly FeedbackSignal[] = ["keep", "drop", "too_long", "wrong_topic"];

/** The feedback-button label for a signal, in the given language. */
function buttonLabel(signal: FeedbackSignal, lang: Language): string {
  const d = messages(lang).digest;
  switch (signal) {
    case "keep":
      return d.btnKeep;
    case "drop":
      return d.btnDrop;
    case "too_long":
      return d.btnTooLong;
    case "wrong_topic":
      return d.btnWrongTopic;
    default:
      return signal;
  }
}

export function digestHeader(
  outcome: Extract<DigestOutcome, { kind: "digest" }>,
  lang: Language,
  now: Date = new Date(),
): string {
  const d = messages(lang).digest;
  const { released, upcoming } = partitionPicks(outcome.picks, now);
  const lines: string[] = [];
  if (released.length === 0 && upcoming.length === 0) {
    lines.push(d.headerEmpty(outcome.runDate));
  } else if (upcoming.length === 0) {
    lines.push(d.header(outcome.runDate, released.length));
  } else if (released.length === 0) {
    lines.push(d.headerUpcomingOnly(outcome.runDate, upcoming.length));
  } else {
    lines.push(d.headerWithUpcoming(outcome.runDate, released.length, upcoming.length));
  }
  if (outcome.morePicksCount > 0) {
    lines.push(d.morePicks(outcome.morePicksCount));
  }
  if (outcome.alertPct) {
    lines.push(d.budgetNote(outcome.alertPct));
  }
  return lines.join("\n");
}

export interface PickEmbedContext {
  timezone: string;
  now: Date;
}

export function pickEmbed(
  pick: DeliverablePick,
  lang: Language,
  ctx: PickEmbedContext,
): EmbedBuilder {
  const d = messages(lang).digest;
  const upcoming = pick.publishedAt.getTime() > ctx.now.getTime();
  const releaseWhen = upcoming ? formatReleaseAt(pick.publishedAt, ctx.timezone, lang) : null;
  const duration =
    !upcoming && pick.durationSeconds
      ? d.durationPrefix(Math.round(pick.durationSeconds / 60))
      : "";
  const lead = upcoming ? d.notReleasedYet : duration;
  const embed = new EmbedBuilder()
    .setTitle(upcoming ? pick.title : `${pick.rank}. ${pick.title}`)
    .setURL(pick.url)
    .setAuthor({ name: pick.channelTitle })
    .setFooter({ text: `${lead}${pick.channelTitle}` });
  const bullets = pick.summaryBullets.map((b) => `• ${b}`).join("\n");
  const why = pick.why ? `\n${d.why(pick.why)}` : "";
  const releaseLine = releaseWhen ? `**${d.releasesAt(releaseWhen)}**\n` : "";
  const body = `${releaseLine}${bullets}${why}`.trim();
  if (body) embed.setDescription(body);
  if (pick.thumbnailUrl) embed.setThumbnail(pick.thumbnailUrl);
  return embed;
}

export function feedbackButtons(itemId: string, lang: Language): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    BUTTON_SIGNALS.map((signal) =>
      new ButtonBuilder()
        .setCustomId(`${FEEDBACK_PREFIX}:${signal}:${itemId}`)
        .setLabel(buttonLabel(signal, lang))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

/**
 * What a failed run says in #youtube. A `youtube_auth` failure is the only kind the owner
 * has to act on (re-authorize and swap the refresh token), so it gets its own message
 * pointing at the dashboard's how-to; everything else reads as "this broke, I'll retry".
 * The recorded reason is included verbatim — it is what saves a trip to the pod log.
 */
export function failureNote(failure: DigestFailure, lang: Language): string {
  const d = messages(lang).digest;
  return failure.kind === "youtube_auth"
    ? d.runFailedYoutubeAuthNote(failure.message)
    : d.runFailedNote(failure.message);
}

export function rejectedListNote(rejects: DeliverableReject[], lang: Language): string {
  const d = messages(lang).digest;
  const lines = rejects.map((r) => d.rejectedLine(r.title, r.channelTitle || null, r.reason));
  return `${d.rejectedHeader}\n${lines.join("\n")}`;
}

/** One-line audit row persisted to the youtube conversation for agent context. */
export function conversationSummary(outcome: DigestOutcome, now: Date = new Date()): string {
  switch (outcome.kind) {
    case "skipped_budget":
      return "Skipped today's YouTube digest (budget).";
    case "no_profile":
      return "Asked the user to set up their YouTube interest profile.";
    case "failed":
      // Recorded so the failure is visible in the dashboard's activity log (and to the
      // agent, if the owner asks in #youtube why no digest arrived) rather than only in
      // the pod log.
      return `Today's YouTube digest run failed (${outcome.failure.kind}): ${outcome.failure.message}`;
    case "digest": {
      const { released, upcoming } = partitionPicks(outcome.picks, now);
      const releasedLines = released.map((p) => `${p.rank}. ${p.title} (${p.channelTitle})`);
      const upcomingLines = upcoming.map(
        (p) => `${p.title} (${p.channelTitle}, releases ${p.publishedAt.toISOString()})`,
      );
      if (releasedLines.length === 0 && upcomingLines.length === 0) {
        return `Delivered empty YouTube digest ${outcome.runDate} (nothing new).`;
      }
      const body: string[] = [];
      if (releasedLines.length) body.push(releasedLines.join("; "));
      if (upcomingLines.length) body.push(`Coming up: ${upcomingLines.join("; ")}`);
      return (
        `Delivered YouTube digest ${outcome.runDate}: ${body.join(". ")}. ` +
        `Rejected list shown: ${outcome.rejects.length}.`
      );
    }
  }
}

/** The production DigestDeliverer: sends to #youtube (or home as fallback). */
export function createDigestDeliverer(
  client: Client,
  deps: AgentDeps,
  cfg: DiscordConfig,
): DigestDeliverer {
  return {
    async deliver(userId, outcome): Promise<void> {
      const channelId = cfg.youtubeChannelId ?? cfg.homeChannelId;
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isSendable()) {
        throw new Error(`digest channel ${channelId} is not sendable`);
      }

      const settings = await deps.settings.getOrCreate(userId);
      const lang = asLanguage(settings.language);
      const d = messages(lang).digest;
      const now = deps.clock.now();
      const embedCtx: PickEmbedContext = { timezone: settings.timezone, now };

      let firstMessageId: string | null = null;
      if (outcome.kind === "skipped_budget") {
        firstMessageId = (await channel.send(d.skippedBudgetNote)).id;
      } else if (outcome.kind === "no_profile") {
        firstMessageId = (await channel.send(d.noProfileNudge)).id;
      } else if (outcome.kind === "failed") {
        firstMessageId = (await channel.send(failureNote(outcome.failure, lang))).id;
      } else {
        const { released, upcoming } = partitionPicks(outcome.picks, now);
        firstMessageId = (await channel.send(digestHeader(outcome, lang, now))).id;
        for (const pick of released) {
          await channel.send({
            embeds: [pickEmbed(pick, lang, embedCtx)],
            components: [feedbackButtons(pick.itemId, lang)],
          });
        }
        if (upcoming.length > 0) {
          await channel.send(d.upcomingHeader);
          for (const pick of upcoming) {
            await channel.send({
              embeds: [pickEmbed(pick, lang, embedCtx)],
              components: [feedbackButtons(pick.itemId, lang)],
            });
          }
        }
        if (outcome.rejects.length > 0) {
          await channel.send(rejectedListNote(outcome.rejects, lang));
        }
      }

      const conversation = await deps.conversations.getOrCreate(userId, "youtube", channelId);
      await deps.messages.insert({
        conversationId: conversation.id,
        role: "assistant",
        content: conversationSummary(outcome, now),
        discordMessageId: firstMessageId,
      });
      logger.info({ userId, kind: outcome.kind, channelId }, "digest delivered");
    },
  };
}
