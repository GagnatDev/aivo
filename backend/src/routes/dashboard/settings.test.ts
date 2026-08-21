import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/settings", () => {
  it("bundles digest schedule, proactivity, tier, persona, and budget caps (S-1..S-4)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    await deps.settings.update(owner.id, {
      digest_hour: 6,
      persona_prompt: "Be brief.",
      model_tier: "premium",
      proactivity: { digest: { enabled: false, paused_until: null, run_requested_at: null } },
    });

    const res = await request(app).get("/api/dashboard/settings");
    expect(res.status).toBe(200);
    expect(res.body.digest).toMatchObject({
      hour: 6,
      timezone: "Europe/Oslo",
      intervalDays: 1,
      cap: 8,
      proactivity: { enabled: false, pausedUntil: null, runRequestedAt: null },
    });
    expect(res.body.modelTier).toBe("premium");
    expect(res.body.personaPrompt).toBe("Be brief.");
    expect(res.body.budget.monthlyCeiling.cents).toBe(1500);
    expect(res.body.budget.alertThresholds).toEqual([50, 80, 100]);
  });

  it("provisions defaults on first read", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/settings");
    expect(res.status).toBe(200);
    expect(res.body.modelTier).toBe("auto");
    expect(res.body.language).toBe("nb");
    expect(res.body.personaPrompt).toBeNull();
    expect(res.body.digest.proactivity.enabled).toBe(true);
  });
});
