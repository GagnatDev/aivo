import type { Client } from "discord.js";
import type { AgentDeps } from "../agent/deps.js";
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

export const NO_HOME_NUDGE =
  "I'd send your morning weather report, but no home location is set. " +
  'Tell me where you live (e.g. "add my home: Trondheim" then "set Trondheim as home").';

/** The message for a report outcome. `no_home` is normally filtered out upstream, but
 * handled here so the mapping is total and unit-testable. */
export function weatherReportMessage(outcome: WeatherReportOutcome): string {
  switch (outcome.kind) {
    case "report":
      return outcome.text;
    case "no_home":
      return NO_HOME_NUDGE;
    case "error":
      return `I couldn't put together this morning's weather report — the forecast service was unreachable (${outcome.message}). I'll try again tomorrow.`;
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
      const sent = await channel.send(weatherReportMessage(outcome));

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
