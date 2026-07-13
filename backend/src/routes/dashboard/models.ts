import { Router } from "express";
import { z } from "zod";
import { loadBudgetSnapshot } from "../../agent/budget.js";
import { resolveTier } from "../../agent/tools/index.js";
import { DEGRADATION_DESCRIPTIONS } from "./degradation.js";
import type { DashboardDeps } from "./index.js";
import { money } from "./money.js";

const usageQuerySchema = z.object({
  since: z.coerce.date().optional(),
});

/** Start of the current calendar month, UTC — the repos' `date_trunc` boundary. */
function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Models & Pricing endpoints (M2, PRD §4.4): the active pricing table, the
 * cheap/premium tier mapping, the user's tier preference and its effective tier
 * after budget degradation (mirroring preCallCheck's coercion, read-only), and
 * per-model usage share. Superset of Discord `!models`; writes stay in the
 * Discord/agent models tool for v1.
 */
export function modelsRoutes(deps: DashboardDeps): Router {
  const router = Router();

  // Pricing table + tier resolution + user preference (M-1, M-2, M-3).
  router.get("/api/dashboard/models", async (req, res) => {
    const userId = req.userId!;
    const [rows, cheap, premium, settings, snapshot] = await Promise.all([
      deps.modelPricing.listActive(),
      deps.modelPricing.getByTier("cheap"),
      deps.modelPricing.getByTier("premium"),
      deps.settings.getOrCreate(userId),
      loadBudgetSnapshot(deps, userId),
    ]);
    const requestedTier = resolveTier(settings.model_tier);
    // Same coercion as preCallCheck (agent/budget.ts): any degraded state forces
    // the cheap tier. Read-only here — the state is persisted on real agent turns.
    const effectiveTier = snapshot.state === "normal" ? requestedTier : "cheap";
    res.json({
      models: rows.map((r) => ({
        modelId: r.model_id,
        tierRole: r.tier_role,
        capabilities: r.capabilities,
        inputCentsPerMtok: Number(r.input_cost_per_mtok_cents),
        outputCentsPerMtok: Number(r.output_cost_per_mtok_cents),
        audioCentsPerMin:
          r.audio_cost_per_min_cents != null ? Number(r.audio_cost_per_min_cents) : null,
        currency: r.currency,
      })),
      tiers: {
        cheap: cheap?.model_id ?? null,
        premium: premium?.model_id ?? null,
      },
      tierPreference: settings.model_tier,
      requestedTier,
      effectiveTier,
      degradation: {
        state: snapshot.state,
        description: DEGRADATION_DESCRIPTIONS[snapshot.state],
      },
    });
  });

  // Per-model spend/call totals for the usage-share view (M-4).
  router.get("/api/dashboard/models/usage", async (req, res) => {
    const query = usageQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const since = query.data.since ?? startOfUtcMonth(new Date());
    const totals = await deps.llmUsage.modelTotals(req.userId!, since);
    res.json({
      since: since.toISOString(),
      models: totals.map((t) => ({
        model: t.model,
        cost: money(t.costCents),
        calls: t.calls,
        tokensIn: t.tokensIn,
        tokensOut: t.tokensOut,
      })),
    });
  });

  return router;
}
