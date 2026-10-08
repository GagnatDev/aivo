import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { testDb, useCleanDb } from "../../test/db.js";

useCleanDb();

/** Insert a ledger row at an explicit instant (the repo's insert always stamps now()). */
async function insertUsageAt(
  userId: string,
  createdAt: Date,
  fields: { taskType?: string; model?: string; costCents: number; tokensIn?: number },
) {
  await testDb()
    .insertInto("llm_usage")
    .values({
      user_id: userId,
      task_type: fields.taskType ?? "chat",
      model: fields.model ?? "test-model",
      tokens_in: fields.tokensIn ?? 100,
      tokens_out: 50,
      cost_cents: fields.costCents,
      created_at: createdAt,
    })
    .execute();
}

describe("GET /api/dashboard/usage/summary", () => {
  it("returns spend, caps, thresholds, and the degradation explanation", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.llmUsage.insert({
      userId: owner.id,
      taskType: "chat",
      model: "test-model",
      tokensIn: 100,
      tokensOut: 50,
      costCents: 2.5,
    });

    const res = await request(app).get("/api/dashboard/usage/summary");
    expect(res.status).toBe(200);
    expect(res.body.today).toEqual({ cents: 2.5, formatted: "2.5¢" });
    expect(res.body.monthToDate.cents).toBe(2.5);
    // budget_config defaults: 1500¢ ceiling, [50,80,100] alerts, no soft cap.
    expect(res.body.monthlyCeiling).toEqual({ cents: 1500, formatted: "€15.00" });
    expect(res.body.dailySoftCap).toBeNull();
    expect(res.body.approvalThreshold).toBeNull();
    expect(res.body.alertThresholds).toEqual([50, 80, 100]);
    expect(res.body.pctOfCeiling).toBeCloseTo((2.5 / 1500) * 100);
    expect(res.body.degradation.state).toBe("normal");
    expect(res.body.degradation.description).toMatch(/within budget/i);
  });

  it("reports the degraded state once spend crosses the cheap-models threshold", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.budgetConfig.update(owner.id, { monthly_ceiling_cents: 100 });
    await deps.llmUsage.insert({
      userId: owner.id,
      taskType: "chat",
      model: "test-model",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 85,
    });

    const res = await request(app).get("/api/dashboard/usage/summary");
    expect(res.body.degradation.state).toBe("cheap_models");
    expect(res.body.degradation.description).toMatch(/cheap model tier/i);
  });
});

describe("GET /api/dashboard/usage/series", () => {
  it("buckets spend and tokens per UTC day within the range", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await insertUsageAt(owner.id, new Date("2026-06-01T08:00:00Z"), { costCents: 1 });
    await insertUsageAt(owner.id, new Date("2026-06-01T20:00:00Z"), { costCents: 2 });
    await insertUsageAt(owner.id, new Date("2026-06-03T12:00:00Z"), { costCents: 4 });
    // Outside the requested range — must not appear.
    await insertUsageAt(owner.id, new Date("2026-07-01T00:00:00Z"), { costCents: 99 });

    const res = await request(app).get(
      "/api/dashboard/usage/series?from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z",
    );
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBeNull();
    expect(res.body.buckets).toEqual([
      {
        day: "2026-06-01",
        group: null,
        cost: { cents: 3, formatted: "3¢" },
        calls: 2,
        tokensIn: 200,
        tokensOut: 100,
      },
      {
        day: "2026-06-03",
        group: null,
        cost: { cents: 4, formatted: "4¢" },
        calls: 1,
        tokensIn: 100,
        tokensOut: 50,
      },
    ]);
  });

  it("splits buckets by model when groupBy=model", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await insertUsageAt(owner.id, new Date("2026-06-02T08:00:00Z"), {
      costCents: 1,
      model: "cheap-1",
    });
    await insertUsageAt(owner.id, new Date("2026-06-02T09:00:00Z"), {
      costCents: 2,
      model: "premium-1",
    });

    const res = await request(app).get(
      "/api/dashboard/usage/series?from=2026-06-01T00:00:00Z&to=2026-06-08T00:00:00Z&groupBy=model",
    );
    expect(res.body.groupBy).toBe("model");
    expect(res.body.buckets.map((b: { group: string }) => b.group)).toEqual([
      "cheap-1",
      "premium-1",
    ]);
  });

  it("never leaks another user's usage", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await insertUsageAt(other.id, new Date("2026-06-02T08:00:00Z"), { costCents: 50 });
    await insertUsageAt(owner.id, new Date("2026-06-02T08:00:00Z"), { costCents: 1 });

    const res = await request(app).get(
      "/api/dashboard/usage/series?from=2026-06-01T00:00:00Z&to=2026-06-08T00:00:00Z",
    );
    expect(res.body.buckets).toHaveLength(1);
    expect(res.body.buckets[0].cost.cents).toBe(1);
  });

  it("400s an invalid or inverted date range", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const garbage = await request(app).get("/api/dashboard/usage/series?from=not-a-date");
    expect(garbage.status).toBe(400);
    const inverted = await request(app).get(
      "/api/dashboard/usage/series?from=2026-06-08T00:00:00Z&to=2026-06-01T00:00:00Z",
    );
    expect(inverted.status).toBe(400);
    const bogusGroup = await request(app).get("/api/dashboard/usage/series?groupBy=user_id");
    expect(bogusGroup.status).toBe(400);
  });
});

describe("GET /api/dashboard/usage/drivers", () => {
  it("ranks (model, task_type) pairs by spend", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await insertUsageAt(owner.id, new Date("2026-06-02T08:00:00Z"), {
      costCents: 5,
      model: "premium-1",
      taskType: "chat",
    });
    await insertUsageAt(owner.id, new Date("2026-06-02T09:00:00Z"), {
      costCents: 1,
      model: "cheap-1",
      taskType: "stage1_rank",
    });

    const res = await request(app).get("/api/dashboard/usage/drivers?since=2026-06-01T00:00:00Z");
    expect(res.status).toBe(200);
    expect(res.body.drivers).toEqual([
      { model: "premium-1", taskType: "chat", cost: { cents: 5, formatted: "5¢" }, calls: 1 },
      {
        model: "cheap-1",
        taskType: "stage1_rank",
        cost: { cents: 1, formatted: "1¢" },
        calls: 1,
      },
    ]);
  });

  it("caps limit at 50", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/usage/drivers?limit=999");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/dashboard/usage/export.csv", () => {
  it("downloads the range's ledger rows as CSV with exact fractional cents (U-8)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await insertUsageAt(owner.id, new Date("2026-07-01T10:00:00Z"), {
      model: "cheap-1",
      taskType: "chat",
      costCents: 0.1234,
    });
    await insertUsageAt(owner.id, new Date("2026-07-02T10:00:00Z"), {
      model: 'weird,"model',
      taskType: "stage1_rank",
      costCents: 2.5,
    });

    const res = await request(app).get(
      "/api/dashboard/usage/export.csv?from=2026-07-01T00:00:00Z&to=2026-07-03T00:00:00Z",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="aivo-usage-2026-07-01_2026-07-03.csv"',
    );
    const lines = res.text.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "created_at,model,task_type,tokens_in,tokens_out,cost_cents,tokens_cached",
    );
    expect(lines[1]).toBe("2026-07-01T10:00:00.000Z,cheap-1,chat,100,50,0.1234,0");
    // Fields with commas/quotes are quoted per RFC 4180.
    expect(lines[2]).toBe('2026-07-02T10:00:00.000Z,"weird,""model",stage1_rank,100,50,2.5,0');
  });

  it("never exports another user's rows and 400s a backwards range", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await insertUsageAt(other.id, new Date("2026-07-01T10:00:00Z"), { costCents: 9 });

    const res = await request(app).get(
      "/api/dashboard/usage/export.csv?from=2026-07-01T00:00:00Z&to=2026-07-02T00:00:00Z",
    );
    expect(res.text.trimEnd().split("\n")).toHaveLength(1);

    const bad = await request(app).get(
      "/api/dashboard/usage/export.csv?from=2026-07-02T00:00:00Z&to=2026-07-01T00:00:00Z",
    );
    expect(bad.status).toBe(400);
  });
});
