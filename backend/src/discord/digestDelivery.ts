import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
} from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
import type { DeliverablePick, DeliverableReject, DigestOutcome } from "../digest/pipeline.js";
import type { FeedbackSignal } from "../db/schema.enums.js";
import { logger } from "../logger.js";
import type { DigestDeliverer } from "../scheduler/tick.js";
import type { DiscordConfig } from "./config.js";

/**
 * Renders a digest run into #youtube: a header, one embed + feedback-button row per
 * pick, and a compact rejected list (cold-start calibration). The builders are pure
 * and unit-tested; only the thin send loop touches discord.js. A summary row is
 * persisted to the youtube conversation so the agent has context when the user replies
 * there.
 */

// customId prefix for digest feedback buttons: `fb:<signal>:<digest_item_id>`.
export const FEEDBACK_PREFIX = "fb";
const BUTTONS: Array<{ signal: FeedbackSignal; label: string }> = [
  { signal: "keep", label: "👍 Keep" },
  { signal: "drop", label: "👎 Drop" },
  { signal: "too_long", label: "⏱ Too long" },
  { signal: "wrong_topic", label: "🚫 Wrong topic" },
];

export function digestHeader(outcome: Extract<DigestOutcome, { kind: "digest" }>): string {
  const lines: string[] = [];
  if (outcome.picks.length === 0) {
    lines.push(`**YouTube digest — ${outcome.runDate}**: nothing new worth your time. 🎉`);
  } else {
    lines.push(
      `**YouTube digest — ${outcome.runDate}** · ${outcome.picks.length} pick${outcome.picks.length === 1 ? "" : "s"}`,
    );
  }
  if (outcome.morePicksCount > 0) {
    lines.push(
      `*(${outcome.morePicksCount} more matched with lower confidence — ask me to "show more picks".)*`,
    );
  }
  if (outcome.alertPct) {
    lines.push(`*(Budget: you've used about ${outcome.alertPct}% of this month's ceiling.)*`);
  }
  return lines.join("\n");
}

export function pickEmbed(pick: DeliverablePick): EmbedBuilder {
  const duration = pick.durationSeconds ? `${Math.round(pick.durationSeconds / 60)} min · ` : "";
  const embed = new EmbedBuilder()
    .setTitle(`${pick.rank}. ${pick.title}`)
    .setURL(pick.url)
    .setAuthor({ name: pick.channelTitle })
    .setFooter({ text: `${duration}${pick.channelTitle}` });
  const bullets = pick.summaryBullets.map((b) => `• ${b}`).join("\n");
  const why = pick.why ? `\n*Why: ${pick.why}*` : "";
  if (bullets || why) embed.setDescription(`${bullets}${why}`.trim());
  if (pick.thumbnailUrl) embed.setThumbnail(pick.thumbnailUrl);
  return embed;
}

export function feedbackButtons(itemId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    BUTTONS.map((b) =>
      new ButtonBuilder()
        .setCustomId(`${FEEDBACK_PREFIX}:${b.signal}:${itemId}`)
        .setLabel(b.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

export function rejectedListNote(rejects: DeliverableReject[]): string {
  const lines = rejects.map(
    (r) => `• ${r.title}${r.channelTitle ? ` (${r.channelTitle})` : ""} — skipped: ${r.reason}`,
  );
  return `**Also new, but skipped** *(correct me if I got one wrong)*:\n${lines.join("\n")}`;
}

export const NO_PROFILE_NUDGE =
  "I couldn't build your YouTube digest yet — I don't know your interests. " +
  'Tell me what you like watching (e.g. "set up my YouTube interests: hand-tool ' +
  'woodworking, no shorts") and I\'ll start tomorrow morning — or say "run the digest now".';

export const SKIPPED_BUDGET_NOTE =
  "I skipped today's YouTube digest to stay inside your budget — direct chat still works. " +
  'Raise the budget or say "run the digest now" to override.';

/** One-line audit row persisted to the youtube conversation for agent context. */
export function conversationSummary(outcome: DigestOutcome): string {
  switch (outcome.kind) {
    case "skipped_budget":
      return "Skipped today's YouTube digest (budget).";
    case "no_profile":
      return "Asked the user to set up their YouTube interest profile.";
    case "digest": {
      const picks = outcome.picks.map((p) => `${p.rank}. ${p.title} (${p.channelTitle})`);
      return picks.length
        ? `Delivered YouTube digest ${outcome.runDate}: ${picks.join("; ")}. Rejected list shown: ${outcome.rejects.length}.`
        : `Delivered empty YouTube digest ${outcome.runDate} (nothing new).`;
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

      let firstMessageId: string | null = null;
      if (outcome.kind === "skipped_budget") {
        firstMessageId = (await channel.send(SKIPPED_BUDGET_NOTE)).id;
      } else if (outcome.kind === "no_profile") {
        firstMessageId = (await channel.send(NO_PROFILE_NUDGE)).id;
      } else {
        firstMessageId = (await channel.send(digestHeader(outcome))).id;
        for (const pick of outcome.picks) {
          await channel.send({
            embeds: [pickEmbed(pick)],
            components: [feedbackButtons(pick.itemId)],
          });
        }
        if (outcome.rejects.length > 0) {
          await channel.send(rejectedListNote(outcome.rejects));
        }
      }

      const conversation = await deps.conversations.getOrCreate(userId, "youtube", channelId);
      await deps.messages.insert({
        conversationId: conversation.id,
        role: "assistant",
        content: conversationSummary(outcome),
        discordMessageId: firstMessageId,
      });
      logger.info({ userId, kind: outcome.kind, channelId }, "digest delivered");
    },
  };
}
