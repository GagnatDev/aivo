import { describe, expect, it } from "vitest";
import type { DigestOutcome } from "../digest/pipeline.js";
import { withDigestLane, parseDigestLane } from "../digest/proactivity.js";
import type { ReminderRow } from "../storage/reminderRepository.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { makeFakeWeather } from "../test/fakeWeather.js";
import { makeFakeYoutube } from "../test/fakeYoutube.js";
import { tokenRefreshError } from "../youtube/errors.js";
import { parseWeatherLane, withWeatherLane } from "../weather/proactivity.js";
import type { WeatherReportOutcome } from "../weather/report.js";
import { runDueWork, type Deliverers } from "./tick.js";

useCleanDb();

// 05:30 UTC = 07:30 Europe/Oslo (the default settings timezone, digest_hour 7).
const DUE_TIME = new Date("2026-07-01T05:30:00Z");
const BEFORE_HOUR = new Date("2026-07-01T03:00:00Z");

function captureDeliveries(): {
  deliverer: Deliverers;
  delivered: DigestOutcome[];
  reminded: ReminderRow[];
  weatherReports: WeatherReportOutcome[];
} {
  const delivered: DigestOutcome[] = [];
  const reminded: ReminderRow[] = [];
  const weatherReports: WeatherReportOutcome[] = [];
  return {
    delivered,
    reminded,
    weatherReports,
    deliverer: {
      digest: {
        async deliver(_userId, outcome) {
          delivered.push(outcome);
        },
      },
      reminder: {
        async deliver(reminder) {
          reminded.push(reminder);
        },
      },
      weather: {
        async deliver(_userId, outcome) {
          weatherReports.push(outcome);
        },
      },
    },
  };
}

async function setupOwner(now: Date, llmScript: Parameters<typeof makeFakeLlm>[0] = []) {
  const deps = makeAgentDeps(makeFakeLlm(llmScript), {}, new FakeClock(now));
  const { userId } = await provisionUser(deps, OWNER_ID);
  await deps.profiles.setCurrent(userId, "youtube_interest", "likes woodworking");
  return { deps, userId };
}

describe("runDueWork", () => {
  it("runs and delivers a due digest, then marks it delivered", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const { deliverer, delivered } = captureDeliveries();
    await runDueWork(deps, makeFakeYoutube(), deliverer, DUE_TIME);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].kind).toBe("digest");
    expect((await deps.digests.latestForUser(userId))?.status).toBe("delivered");
  });

  it("does nothing before the configured hour, when already run, or when disabled", async () => {
    const { deps, userId } = await setupOwner(BEFORE_HOUR);
    const { deliverer, delivered } = captureDeliveries();
    await runDueWork(deps, makeFakeYoutube(), deliverer, BEFORE_HOUR);
    expect(delivered).toHaveLength(0);

    // Past the hour it runs once…
    await runDueWork(deps, makeFakeYoutube(), deliverer, DUE_TIME);
    expect(delivered).toHaveLength(1);
    // …and the watermark stops a second run the same day.
    await runDueWork(deps, makeFakeYoutube(), deliverer, DUE_TIME);
    expect(delivered).toHaveLength(1);

    // Next day, but the lane is switched off: still nothing.
    const settings = await deps.settings.getOrCreate(userId);
    await deps.settings.update(userId, {
      proactivity: withDigestLane(settings.proactivity, { enabled: false }),
    });
    await runDueWork(deps, makeFakeYoutube(), deliverer, new Date("2026-07-02T05:30:00Z"));
    expect(delivered).toHaveLength(1);
  });

  it("consumes a chat-requested run even while paused", async () => {
    const { deps, userId } = await setupOwner(BEFORE_HOUR);
    const settings = await deps.settings.getOrCreate(userId);
    await deps.settings.update(userId, {
      proactivity: withDigestLane(settings.proactivity, {
        pausedUntil: new Date("2026-08-01T00:00:00Z"),
        runRequestedAt: BEFORE_HOUR,
      }),
    });
    const { deliverer, delivered } = captureDeliveries();
    await runDueWork(deps, makeFakeYoutube(), deliverer, BEFORE_HOUR);
    expect(delivered).toHaveLength(1);
    // The request flag is consumed; the pause stays.
    const after = parseDigestLane((await deps.settings.getOrCreate(userId)).proactivity);
    expect(after.runRequestedAt).toBeNull();
    expect(after.pausedUntil).not.toBeNull();
  });

  it("is a no-op without YouTube integrations or without an owner", async () => {
    const { deliverer, delivered } = captureDeliveries();
    const withoutOwner = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(DUE_TIME));
    await runDueWork(withoutOwner, makeFakeYoutube(), deliverer, DUE_TIME);

    const { deps } = await setupOwner(DUE_TIME);
    await runDueWork(deps, null, deliverer, DUE_TIME);
    expect(delivered).toHaveLength(0);
  });

  it("sweeps stale approval prompts on every tick, even without YouTube", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const convo = await deps.conversations.getOrCreate(userId, "chat", "chan-1");
    const approval = await deps.pendingApprovals.create({
      userId,
      conversationId: convo.id,
      triggerMessageId: "t-1",
      estimatedCostCents: 60,
      taskType: "chat",
    });
    const { deliverer } = captureDeliveries();
    // The row's created_at is DB-side wall-clock time, so sweep relative to real now:
    // two hours later (TTL is 60 min), no YouTube configured — the sweep still runs.
    await runDueWork(deps, null, deliverer, new Date(Date.now() + 2 * 60 * 60_000));
    expect((await deps.pendingApprovals.findById(approval.id))?.status).toBe("expired");
  });

  it("delivers due reminders (even without YouTube) and marks them delivered", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const due = await deps.reminders.insert({
      userId,
      text: "call the dentist",
      dueAt: new Date(DUE_TIME.getTime() - 60_000),
    });
    await deps.reminders.insert({
      userId,
      text: "future",
      dueAt: new Date(DUE_TIME.getTime() + 60_000),
    });
    const { deliverer, reminded } = captureDeliveries();

    await runDueWork(deps, null, deliverer, DUE_TIME);
    expect(reminded.map((r) => r.text)).toEqual(["call the dentist"]);
    expect((await deps.reminders.findById(due.id))?.status).toBe("delivered");

    // Delivered — the next tick doesn't re-send it.
    await runDueWork(deps, null, deliverer, DUE_TIME);
    expect(reminded).toHaveLength(1);
  });

  it("collapses same-user duplicate reminders due together into one delivery", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const dueAt = new Date(DUE_TIME.getTime() - 60_000);
    const first = await deps.reminders.insert({ userId, text: "kampen starter", dueAt });
    const dup = await deps.reminders.insert({ userId, text: "  Kampen starter", dueAt });
    await deps.reminders.insert({ userId, text: "noe annet", dueAt });
    // Another user's identical text is their own reminder — never collapsed.
    const { userId: otherUser } = await provisionUser(deps, "member-1");
    await deps.reminders.insert({ userId: otherUser, text: "kampen starter", dueAt });
    const { deliverer, reminded } = captureDeliveries();

    await runDueWork(deps, null, deliverer, DUE_TIME);
    // Ties on due_at deliver in unspecified order, so assert on normalized texts.
    const ownerTexts = reminded
      .filter((r) => r.user_id === userId)
      .map((r) => r.text.trim().toLowerCase())
      .sort();
    expect(ownerTexts).toEqual(["kampen starter", "noe annet"]);
    expect(reminded.filter((r) => r.user_id === otherUser)).toHaveLength(1);

    // The collapsed duplicate is consumed too — it won't fire on a later tick.
    expect((await deps.reminders.findById(first.id))?.status).toBe("delivered");
    expect((await deps.reminders.findById(dup.id))?.status).toBe("delivered");
    await runDueWork(deps, null, deliverer, DUE_TIME);
    expect(reminded).toHaveLength(3);
  });

  it("does not deliver cancelled reminders", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const r = await deps.reminders.insert({ userId, text: "nope", dueAt: BEFORE_HOUR });
    await deps.reminders.cancel(r.id, userId);
    const { deliverer, reminded } = captureDeliveries();
    await runDueWork(deps, null, deliverer, DUE_TIME);
    expect(reminded).toHaveLength(0);
  });

  it("delivers a due weather report once per day and watermarks it", async () => {
    // 05:00Z = 07:00 Europe/Oslo, past the default report hour 6.
    const now = new Date("2026-07-01T05:00:00Z");
    const deps = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(now), null, makeFakeWeather());
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.setHome(userId, "Oslo");
    const settings = await deps.settings.getOrCreate(userId);
    await deps.settings.update(userId, {
      proactivity: withWeatherLane(settings.proactivity, { enabled: true }),
    });
    const { deliverer, weatherReports } = captureDeliveries();

    await runDueWork(deps, null, deliverer, now);
    expect(weatherReports.map((r) => r.kind)).toEqual(["report"]);
    expect(
      parseWeatherLane((await deps.settings.getOrCreate(userId)).proactivity).lastReportDate,
    ).toBe("2026-07-01");

    // Same day → watermark suppresses a second send.
    await runDueWork(deps, null, deliverer, now);
    expect(weatherReports).toHaveLength(1);
  });

  it("skips the weather report (no send, no watermark) when no home is set", async () => {
    const now = new Date("2026-07-01T05:00:00Z");
    const deps = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(now), null, makeFakeWeather());
    const { userId } = await provisionUser(deps, OWNER_ID);
    const settings = await deps.settings.getOrCreate(userId);
    await deps.settings.update(userId, {
      proactivity: withWeatherLane(settings.proactivity, { enabled: true }),
    });
    const { deliverer, weatherReports } = captureDeliveries();

    await runDueWork(deps, null, deliverer, now);
    expect(weatherReports).toHaveLength(0);
    // No watermark — setting a home later the same day still lets it fire.
    expect(
      parseWeatherLane((await deps.settings.getOrCreate(userId)).proactivity).lastReportDate,
    ).toBeNull();
  });

  it("does not run the weather report when the weather client is unconfigured", async () => {
    const now = new Date("2026-07-01T05:00:00Z");
    const deps = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(now)); // weather = null
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.weatherLocations.upsert(userId, { name: "Oslo", latitude: 59.9, longitude: 10.7 });
    await deps.weatherLocations.setHome(userId, "Oslo");
    const settings = await deps.settings.getOrCreate(userId);
    await deps.settings.update(userId, {
      proactivity: withWeatherLane(settings.proactivity, { enabled: true }),
    });
    const { deliverer, weatherReports } = captureDeliveries();

    await runDueWork(deps, null, deliverer, now);
    expect(weatherReports).toHaveLength(0);
  });

  it("leaves a budget-skipped run un-delivered so the day is still watermarked", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "m",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1425, // 95% of the default 1500¢ ceiling → proactive_paused
    });
    const { deliverer, delivered } = captureDeliveries();
    await runDueWork(deps, makeFakeYoutube(), deliverer, DUE_TIME);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].kind).toBe("skipped_budget");
    expect((await deps.digests.latestForUser(userId))?.status).toBe("skipped_budget");
  });

  it("delivers a failed run without marking it delivered, and keeps ticking (#83)", async () => {
    const { deps, userId } = await setupOwner(DUE_TIME);
    const yt = makeFakeYoutube();
    yt.api.listSubscriptions = () => {
      throw tokenRefreshError(400, '{"error":"invalid_grant"}');
    };
    const { deliverer, delivered } = captureDeliveries();

    // Previously this threw out of runDueWork, skipping the rest of the tick.
    await runDueWork(deps, yt, deliverer, DUE_TIME);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].kind).toBe("failed");
    const run = await deps.digests.latestForUser(userId);
    expect(run?.status).toBe("failed");
    expect(run?.delivered_at).toBeNull();
  });
});
