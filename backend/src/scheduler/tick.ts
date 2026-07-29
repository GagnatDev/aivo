import type { AgentDeps } from "../agent/deps.js";
import type { DigestOutcome, YoutubeIntegrations } from "../digest/pipeline.js";
import { runDigest } from "../digest/pipeline.js";
import { digestDue, localDate } from "../digest/due.js";
import { parseDigestLane, withDigestLane } from "../digest/proactivity.js";
import type { ReminderRow } from "../storage/reminderRepository.js";
import type { WeatherClient } from "../weather/client.js";
import { weatherReportDue } from "../weather/due.js";
import { parseWeatherLane, withWeatherLane } from "../weather/proactivity.js";
import { runWeatherReport, type WeatherReportOutcome } from "../weather/report.js";
import { logger } from "../logger.js";

/**
 * The "what" of the scheduler, split from the "when" (scheduler/cron.ts) so due-work
 * dispatch is unit-testable against the test DB with a fake clock
 * (docs/architecture-improvements.md §1.3). Called every minute; queries for due work
 * and dispatches it. Idempotent across restarts: the digest watermark is the latest
 * digests row, created before any paid work.
 */

/** How a finished digest run reaches the user — implemented by the Discord layer. */
export interface DigestDeliverer {
  deliver(userId: string, outcome: DigestOutcome): Promise<void>;
}

/** How a due reminder reaches the user — implemented by the Discord layer. */
export interface ReminderDeliverer {
  deliver(reminder: ReminderRow): Promise<void>;
}

/** How the daily weather report reaches the user — implemented by the Discord layer. */
export interface WeatherReportDeliverer {
  deliver(userId: string, outcome: WeatherReportOutcome): Promise<void>;
}

/** The scheduler's outbound channels, wired to Discord at the composition root. */
export interface Deliverers {
  digest: DigestDeliverer;
  reminder: ReminderDeliverer;
  weather: WeatherReportDeliverer;
}

/**
 * Run whatever is due at `now`. YouTube integrations are null until the OAuth
 * credentials are configured — the digest lane simply stays dark (logged once per
 * process at the composition root, not here, to keep the minutely tick quiet).
 */
export async function runDueWork(
  deps: AgentDeps,
  yt: YoutubeIntegrations | null,
  deliverers: Deliverers,
  now: Date,
): Promise<void> {
  // Sweep stale approval-gate prompts every tick (previously a one-shot at boot —
  // docs/architecture-improvements.md §1.3), so an abandoned prompt expires while the
  // process keeps running, not just across restarts.
  await deps.pendingApprovals.expireOlderThan(
    new Date(now.getTime() - deps.config.approvalTtlMinutes * 60_000),
  );

  // Reminders: per-user, template-rendered (zero LLM cost), so they deliver regardless
  // of the YouTube lane or budget degradation — the user explicitly asked for each one.
  // Marked delivered only after the send succeeds: a crash in between re-sends next
  // tick (at-least-once), matching the digest's delivery semantics. Rows with the same
  // user + text that come due together collapse into one send: a flailing model can
  // stack identical reminders (or reschedule several onto the same instant), and
  // delivering each row separately turns one nudge into a burst of pings.
  const sentKeys = new Set<string>();
  for (const reminder of await deps.reminders.listDue(now)) {
    const key = `${reminder.user_id}:${reminder.text.trim().toLowerCase()}`;
    if (sentKeys.has(key)) {
      await deps.reminders.markDelivered(reminder.id, now);
      logger.info(
        { userId: reminder.user_id, reminderId: reminder.id },
        "duplicate reminder collapsed",
      );
      continue;
    }
    await deliverers.reminder.deliver(reminder);
    await deps.reminders.markDelivered(reminder.id, now);
    sentKeys.add(key);
    logger.info({ userId: reminder.user_id, reminderId: reminder.id }, "reminder delivered");
  }

  // Weather morning report (owner-scoped, like the digest, but independent of the
  // YouTube lane and its OAuth config). Runs only when the forecast client is wired.
  if (deps.weather) {
    await runDueWeatherReport(deps, deps.weather, deliverers.weather, now);
  }

  if (!yt) return;

  // The digest is owner-scoped; before the owner's first message there is no one to
  // deliver to.
  const owner = await deps.users.findOwner();
  if (!owner) return;

  const settings = await deps.settings.getOrCreate(owner.id);
  const lane = parseDigestLane(settings.proactivity);
  const latest = await deps.digests.latestForUser(owner.id);
  const due = digestDue({
    now,
    timezone: settings.timezone,
    digestHour: settings.digest_hour,
    intervalDays: settings.digest_interval_days,
    lane,
    lastRunDate: latest?.run_date ?? null,
  });
  if (!due.due) return;

  // Consume a chat-requested run before doing the work: if the run then fails, the
  // pending digests row (not a re-armed request flag) is what gates retries.
  if (lane.runRequestedAt) {
    await deps.settings.update(owner.id, {
      proactivity: withDigestLane(settings.proactivity, { runRequestedAt: null }),
    });
  }

  logger.info({ userId: owner.id, reason: due.reason }, "digest run starting");
  const outcome = await runDigest(deps, yt, owner.id, now);
  await deliverers.digest.deliver(owner.id, outcome);
  // `skipped_budget` and `failed` runs already carry their own terminal status; only a
  // real (or empty) digest and the onboarding nudge count as delivered.
  if (outcome.kind !== "skipped_budget" && outcome.kind !== "failed") {
    await deps.digests.markDelivered(outcome.digestId, now);
  }
  logger.info({ userId: owner.id, kind: outcome.kind }, "digest run finished");
}

/**
 * Deliver the owner's morning weather report if it's due. Owner-scoped like the digest.
 * Idempotent per local day via the weather lane's `last_report_date` watermark, written
 * only after a successful send (a crash before it re-sends next tick — at-least-once). A
 * `no_home` outcome delivers nothing and sets no watermark, so a home set later the same
 * day still triggers the report; the chat-requested run flag is always cleared once
 * consumed.
 */
async function runDueWeatherReport(
  deps: AgentDeps,
  weather: WeatherClient,
  deliverer: WeatherReportDeliverer,
  now: Date,
): Promise<void> {
  const owner = await deps.users.findOwner();
  if (!owner) return;
  const settings = await deps.settings.getOrCreate(owner.id);
  const lane = parseWeatherLane(settings.proactivity);
  if (!weatherReportDue({ now, timezone: settings.timezone, lane }).due) return;

  const outcome = await runWeatherReport(deps, weather, owner.id, now);
  if (outcome.kind !== "no_home") {
    await deliverer.deliver(owner.id, outcome);
  }
  const patch: Parameters<typeof withWeatherLane>[1] = { runRequestedAt: null };
  if (outcome.kind !== "no_home") patch.lastReportDate = localDate(now, settings.timezone);
  await deps.settings.update(owner.id, {
    proactivity: withWeatherLane(settings.proactivity, patch),
  });
  logger.info({ userId: owner.id, kind: outcome.kind }, "weather report finished");
}
