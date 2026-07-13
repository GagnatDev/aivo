import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { testDb, useCleanDb } from "../../test/db.js";

useCleanDb();

// The migration-seeded tier holders (007_create_model_pricing.sql). model_pricing is
// not user-scoped, so tests assert on these rows rather than the exact table contents.
const SEEDED_CHEAP = "llama-3.1-8b-instruct";
const SEEDED_PREMIUM = "llama-3.3-70b-instruct";

async function insertUsageAt(
  userId: string,
  createdAt: Date,
  fields: { model: string; costCents: number; tokensIn?: number; tokensOut?: number },
) {
  await testDb()
    .insertInto("llm_usage")
    .values({
      user_id: userId,
      task_type: "chat",
      model: fields.model,
      tokens_in: fields.tokensIn ?? 100,
      tokens_out: fields.tokensOut ?? 50,
      cost_cents: fields.costCents,
      created_at: createdAt,
    })
    .execute();
}

describe("GET /api/dashboard/models", () => {
  it("returns the pricing table, tier mapping, and the user's preference", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);

    const res = await request(app).get("/api/dashboard/models");
    expect(res.status).toBe(200);

    const cheap = res.body.models.find((m: { modelId: string }) => m.modelId === SEEDED_CHEAP);
    expect(cheap).toEqual({
      modelId: SEEDED_CHEAP,
      tierRole: "cheap",
      capabilities: ["chat"],
      inputCentsPerMtok: 20,
      outputCentsPerMtok: 20,
      audioCentsPerMin: null,
      currency: "EUR",
    });
    // The chat tier mapping ignores audio-capable models (whisper/voxtral), so the
    // cheap/premium chat holders stay the seeded llamas.
    expect(res.body.tiers).toEqual({ cheap: SEEDED_CHEAP, premium: SEEDED_PREMIUM });
    // The seeded audio models surface with their capability + per-minute price.
    const voxtral = res.body.models.find(
      (m: { modelId: string }) => m.modelId === "voxtral-small-24b-2507",
    );
    expect(voxtral).toMatchObject({ capabilities: ["audio"], audioCentsPerMin: 10 });
    // Fresh settings row: auto preference resolves to premium; nothing degraded.
    expect(res.body.tierPreference).toBe("auto");
    expect(res.body.requestedTier).toBe("premium");
    expect(res.body.effectiveTier).toBe("premium");
    expect(res.body.degradation.state).toBe("normal");
  });

  it("respects an explicit cheap preference", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.settings.update(owner.id, { model_tier: "cheap" });

    const res = await request(app).get("/api/dashboard/models");
    expect(res.body.tierPreference).toBe("cheap");
    expect(res.body.requestedTier).toBe("cheap");
    expect(res.body.effectiveTier).toBe("cheap");
  });

  it("coerces the effective tier to cheap when the budget is degraded", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.budgetConfig.update(owner.id, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId: owner.id,
      taskType: "chat",
      model: SEEDED_PREMIUM,
      tokensIn: 1,
      tokensOut: 1,
      costCents: 85,
    });

    const res = await request(app).get("/api/dashboard/models");
    expect(res.body.requestedTier).toBe("premium");
    expect(res.body.effectiveTier).toBe("cheap");
    expect(res.body.degradation.state).toBe("cheap_models");
    expect(res.body.degradation.description).toMatch(/cheap model tier/i);
  });
});

describe("GET /api/dashboard/models/usage", () => {
  it("totals spend, calls, and tokens per model, biggest spender first", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await insertUsageAt(owner.id, new Date("2026-06-02T08:00:00Z"), {
      model: SEEDED_CHEAP,
      costCents: 1,
    });
    await insertUsageAt(owner.id, new Date("2026-06-03T08:00:00Z"), {
      model: SEEDED_CHEAP,
      costCents: 2,
    });
    await insertUsageAt(owner.id, new Date("2026-06-04T08:00:00Z"), {
      model: SEEDED_PREMIUM,
      costCents: 5,
    });
    // Before the window — must not count.
    await insertUsageAt(owner.id, new Date("2026-05-30T08:00:00Z"), {
      model: SEEDED_PREMIUM,
      costCents: 99,
    });

    const res = await request(app).get("/api/dashboard/models/usage?since=2026-06-01T00:00:00Z");
    expect(res.status).toBe(200);
    expect(res.body.since).toBe("2026-06-01T00:00:00.000Z");
    expect(res.body.models).toEqual([
      {
        model: SEEDED_PREMIUM,
        cost: { cents: 5, formatted: "5¢" },
        calls: 1,
        tokensIn: 100,
        tokensOut: 50,
      },
      {
        model: SEEDED_CHEAP,
        cost: { cents: 3, formatted: "3¢" },
        calls: 2,
        tokensIn: 200,
        tokensOut: 100,
      },
    ]);
  });

  it("never leaks another user's usage", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await insertUsageAt(other.id, new Date("2026-06-02T08:00:00Z"), {
      model: SEEDED_CHEAP,
      costCents: 50,
    });

    const res = await request(app).get("/api/dashboard/models/usage?since=2026-06-01T00:00:00Z");
    expect(res.body.models).toEqual([]);
  });

  it("400s an invalid since", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/models/usage?since=not-a-date");
    expect(res.status).toBe(400);
  });
});
