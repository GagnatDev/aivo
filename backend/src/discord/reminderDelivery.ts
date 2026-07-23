import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
import { asLanguage, type Language, messages } from "../i18n/index.js";
import type { ReminderRow } from "../storage/reminderRepository.js";
import { logger } from "../logger.js";
import type { ReminderDeliverer } from "../scheduler/tick.js";
import type { DiscordConfig } from "./config.js";

/**
 * Renders a due reminder into the home channel (DISCORD_HOME_CHANNEL_ID — what the
 * concept docs call the "#chat" lane): a mention + the reminder text, with snooze
 * buttons (docs/feature-suggestions.md B5 — snooze-on-delivery is the difference
 * between a reminder feature that gets used and one that gets abandoned). The builders
 * are pure and unit-tested; only the thin send loop touches discord.js. An audit row
 * is persisted to the user's chat conversation so the agent has context on replies.
 */

// customId for reminder snooze buttons: `rem:<option>:<reminder_id>`.
export const REMINDER_PREFIX = "rem";

export type SnoozeOption = "10m" | "1h" | "tomorrow";

const SNOOZE_OPTIONS: readonly SnoozeOption[] = ["10m", "1h", "tomorrow"];

/** The snooze-button label for an option, in the given language. */
function snoozeLabel(option: SnoozeOption, lang: Language): string {
  const r = messages(lang).reminder;
  switch (option) {
    case "10m":
      return r.btn10m;
    case "1h":
      return r.btn1h;
    case "tomorrow":
      return r.btnTomorrow;
  }
}

/** The delivery text. The mention is what makes a reminder a ping, not ambient noise. */
export function reminderMessage(
  reminder: ReminderRow,
  discordUserId: string | null,
  lang: Language,
): string {
  const mention = discordUserId ? `<@${discordUserId}> ` : "";
  return `${mention}${messages(lang).reminder.label} ${reminder.text}`;
}

export function snoozeButtons(reminderId: string, lang: Language): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    SNOOZE_OPTIONS.map((option) =>
      new ButtonBuilder()
        .setCustomId(`${REMINDER_PREFIX}:${option}:${reminderId}`)
        .setLabel(snoozeLabel(option, lang))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

/** The production ReminderDeliverer: sends to the home channel (DISCORD_HOME_CHANNEL_ID). */
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
      const settings = await deps.settings.getOrCreate(reminder.user_id);
      const lang = asLanguage(settings.language);
      const sent = await channel.send({
        content: reminderMessage(reminder, user?.discord_user_id ?? null, lang),
        components: [snoozeButtons(reminder.id, lang)],
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
