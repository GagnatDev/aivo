import type { Client } from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
import { asLanguage, type Language, messages } from "../i18n/index.js";
import { logger } from "../logger.js";
import type { WeatherReportDeliverer } from "../scheduler/tick.js";
import type { WeatherReportOutcome } from "../weather/report.js";
import type { DiscordConfig } from "./config.js";

/**
 * Renders the daily morning weather report into the home channel (DISCORD_HOME_CHANNEL_ID
 * — the concept docs' "#chat" lane), like the reminder deliverer. The report text is
 * already built (templated, no LLM) by weather/report.ts; this module only chooses the
 * message for each outcome and does the thin send. An audit row is persisted to the chat
 * conversation so the agent has context if the owner replies about the weather.
 */

/** The message for a report outcome. `no_home` is normally filtered out upstream, but
 * handled here so the mapping is total and unit-testable. The `report` text is already
 * localized upstream (weather/report.ts builds it in the user's language). */
export function weatherReportMessage(outcome: WeatherReportOutcome, lang: Language): string {
  switch (outcome.kind) {
    case "report":
      return outcome.text;
    case "no_home":
      return messages(lang).weather.noHomeNudge;
    case "error":
      return messages(lang).weather.reportError(outcome.message);
  }
}

/** One-line audit row persisted to the chat conversation for agent context. */
export function conversationSummary(outcome: WeatherReportOutcome): string {
  switch (outcome.kind) {
    case "report":
      return `Delivered the morning weather report for ${outcome.locationName}.`;
    case "no_home":
      return "Skipped the morning weather report (no home location set).";
    case "error":
      return `Morning weather report failed: ${outcome.message}.`;
  }
}

/** The production WeatherReportDeliverer: sends to the home channel. */
export function createWeatherReportDeliverer(
  client: Client,
  deps: AgentDeps,
  cfg: DiscordConfig,
): WeatherReportDeliverer {
  return {
    async deliver(userId, outcome): Promise<void> {
      const channel = await client.channels.fetch(cfg.homeChannelId);
      if (!channel?.isSendable()) {
        throw new Error(`weather channel ${cfg.homeChannelId} is not sendable`);
      }
      const settings = await deps.settings.getOrCreate(userId);
      const sent = await channel.send(weatherReportMessage(outcome, asLanguage(settings.language)));

      const conversation = await deps.conversations.getOrCreate(userId, "chat", cfg.homeChannelId);
      await deps.messages.insert({
        conversationId: conversation.id,
        role: "assistant",
        content: conversationSummary(outcome),
        discordMessageId: sent.id,
      });
      logger.info({ userId, kind: outcome.kind }, "weather report delivered");
    },
  };
}
