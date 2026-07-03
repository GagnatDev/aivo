import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
import type { ReminderRow } from "../storage/reminderRepository.js";
import { logger } from "../logger.js";
import type { ReminderDeliverer } from "../scheduler/tick.js";
import type { DiscordConfig } from "./config.js";

/**
 * Renders a due reminder into #chat: a mention + the reminder text, with snooze
 * buttons (docs/feature-suggestions.md B5 — snooze-on-delivery is the difference
 * between a reminder feature that gets used and one that gets abandoned). The builders
 * are pure and unit-tested; only the thin send loop touches discord.js. An audit row
 * is persisted to the user's chat conversation so the agent has context on replies.
 */

// customId for reminder snooze buttons: `rem:<option>:<reminder_id>`.
export const REMINDER_PREFIX = "rem";

export type SnoozeOption = "10m" | "1h" | "tomorrow";

const BUTTONS: Array<{ option: SnoozeOption; label: string }> = [
  { option: "10m", label: "😴 10 min" },
  { option: "1h", label: "😴 1 hour" },
  { option: "tomorrow", label: "😴 Tomorrow" },
];

/** The delivery text. The mention is what makes a reminder a ping, not ambient noise. */
export function reminderMessage(reminder: ReminderRow, discordUserId: string | null): string {
  const mention = discordUserId ? `<@${discordUserId}> ` : "";
  return `${mention}⏰ **Reminder:** ${reminder.text}`;
}

export function snoozeButtons(reminderId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    BUTTONS.map((b) =>
      new ButtonBuilder()
        .setCustomId(`${REMINDER_PREFIX}:${b.option}:${reminderId}`)
        .setLabel(b.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

/** The production ReminderDeliverer: sends to #chat (the home channel). */
export function createReminderDeliverer(
  client: Client,
  deps: AgentDeps,
  cfg: DiscordConfig,
): ReminderDeliverer {
  return {
    async deliver(reminder): Promise<void> {
      const channel = await client.channels.fetch(cfg.homeChannelId);
      if (!channel?.isSendable()) {
        throw new Error(`reminder channel ${cfg.homeChannelId} is not sendable`);
      }
      const user = await deps.users.findById(reminder.user_id);
      const sent = await channel.send({
        content: reminderMessage(reminder, user?.discord_user_id ?? null),
        components: [snoozeButtons(reminder.id)],
      });

      const conversation = await deps.conversations.getOrCreate(
        reminder.user_id,
        "chat",
        cfg.homeChannelId,
      );
      await deps.messages.insert({
        conversationId: conversation.id,
        role: "assistant",
        content: `Delivered reminder: "${reminder.text}".`,
        discordMessageId: sent.id,
      });
      logger.info({ userId: reminder.user_id, reminderId: reminder.id }, "reminder sent");
    },
  };
}
