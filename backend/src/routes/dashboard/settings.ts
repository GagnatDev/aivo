import { Router } from "express";
import { parseDigestLane } from "../../digest/proactivity.js";
import type { DashboardDeps } from "./index.js";
import { money } from "./money.js";

/**
 * Settings endpoint (M6, PRD §4.8): the single read-only bundle of everything
 * chat-editable — digest schedule and proactivity lane (S-1), persona prompt
 * (S-2), model tier preference (S-3), and budget caps (S-4). Writes stay in
 * Discord for v1; the page renders "change via Discord" against every field
 * (S-5), so this endpoint exposes no mutation.
 */
export function settingsRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/settings", async (req, res) => {
    const userId = req.userId!;
    const [settings, budget] = await Promise.all([
      deps.settings.getOrCreate(userId),
      deps.budgetConfig.getOrCreate(userId),
    ]);
    const digestLane = parseDigestLane(settings.proactivity);

    res.json({
      digest: {
        hour: settings.digest_hour,
        timezone: settings.timezone,
        intervalDays: settings.digest_interval_days,
        cap: settings.digest_cap,
        proactivity: {
          enabled: digestLane.enabled,
          pausedUntil: digestLane.pausedUntil?.toISOString() ?? null,
          runRequestedAt: digestLane.runRequestedAt?.toISOString() ?? null,
        },
      },
      modelTier: settings.model_tier,
      language: settings.language,
      personaPrompt: settings.persona_prompt,
      budget: {
        monthlyCeiling:
          budget.monthly_ceiling_cents > 0 ? money(budget.monthly_ceiling_cents) : null,
        dailySoftCap:
          budget.daily_soft_cap_cents != null ? money(budget.daily_soft_cap_cents) : null,
        approvalThreshold:
          budget.approval_threshold_cents != null ? money(budget.approval_threshold_cents) : null,
        alertThresholds: budget.alert_thresholds,
      },
    });
  });

  return router;
}
