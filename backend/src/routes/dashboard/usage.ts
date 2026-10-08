import { Router } from "express";
import { z } from "zod";
import { loadBudgetSnapshot } from "../../agent/budget.js";
import { csvField, EXPORT_MAX_ROWS } from "./csv.js";
import { DEGRADATION_DESCRIPTIONS } from "./degradation.js";
import type { DashboardDeps } from "./index.js";
import { money } from "./money.js";

/** Longest series/drivers window the API will aggregate in one request. */
const MAX_RANGE_DAYS = 400;

const seriesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupBy: z.enum(["model", "task_type"]).optional(),
});

const exportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const driversQuerySchema = z.object({
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

/** Start of the current calendar month, UTC — the repos' `date_trunc` boundary. */
function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Usage & Budget endpoints (M1, PRD §4.3): budget summary for the header cards,
 * day-bucketed spend/token series for the charts, and top spend drivers. Mounted
 * behind the dashboard auth guard in index.ts; spend is always summed from the
 * `llm_usage` ledger via the repository — never a stored rollup.
 */
export function usageRoutes(deps: DashboardDeps): Router {
  const router = Router();

  // Today / MTD spend, caps, alert thresholds, and the degradation state (U-1, U-5, U-6).
  router.get("/api/dashboard/usage/summary", async (req, res) => {
    const userId = req.userId!;
    const snapshot = await loadBudgetSnapshot(deps, userId);
    const config = await deps.budgetConfig.getOrCreate(userId);
    res.json({
      today: money(snapshot.dailyCents),
      monthToDate: money(snapshot.monthToDateCents),
      monthlyCeiling: snapshot.monthlyCeilingCents > 0 ? money(snapshot.monthlyCeilingCents) : null,
      dailySoftCap: snapshot.dailySoftCapCents != null ? money(snapshot.dailySoftCapCents) : null,
      approvalThreshold:
        snapshot.approvalThresholdCents != null ? money(snapshot.approvalThresholdCents) : null,
      alertThresholds: config.alert_thresholds,
      pctOfCeiling: snapshot.pctOfCeiling,
      degradation: {
        state: snapshot.state,
        description: DEGRADATION_DESCRIPTIONS[snapshot.state],
      },
    });
  });

  // Day-bucketed spend/tokens, optionally split by model or task type (U-2, U-4).
  router.get("/api/dashboard/usage/series", async (req, res) => {
    const query = seriesQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const now = new Date();
    const from = query.data.from ?? startOfUtcMonth(now);
    const to = query.data.to ?? now;
    if (from >= to || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "bad_request", reason: "invalid date range" });
      return;
    }
    const buckets = await deps.llmUsage.dailySeries(req.userId!, {
      from,
      to,
      ...(query.data.groupBy !== undefined && { groupBy: query.data.groupBy }),
    });
    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: query.data.groupBy ?? null,
      buckets: buckets.map((b) => ({
        day: b.day,
        group: b.group,
        cost: money(b.costCents),
        calls: b.calls,
        tokensIn: b.tokensIn,
        tokensOut: b.tokensOut,
      })),
    });
  });

  // Raw ledger rows for the current view as a CSV download (U-8). Costs are
  // exported as exact fractional cents — spreadsheet math stays lossless.
  router.get("/api/dashboard/usage/export.csv", async (req, res) => {
    const query = exportQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const now = new Date();
    const from = query.data.from ?? startOfUtcMonth(now);
    const to = query.data.to ?? now;
    if (from >= to || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "bad_request", reason: "invalid date range" });
      return;
    }
    const rows = await deps.llmUsage.listRows(req.userId!, { from, to, limit: EXPORT_MAX_ROWS });
    const lines = [
      "created_at,model,task_type,tokens_in,tokens_out,cost_cents,tokens_cached",
      ...rows.map((r) =>
        [
          r.createdAt.toISOString(),
          csvField(r.model),
          csvField(r.taskType),
          String(r.tokensIn),
          String(r.tokensOut),
          String(r.costCents),
          String(r.tokensCached),
        ].join(","),
      ),
    ];
    const stamp = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="aivo-usage-${stamp}.csv"`);
    if (rows.length === EXPORT_MAX_ROWS) res.setHeader("X-Export-Truncated", "true");
    res.send(`${lines.join("\n")}\n`);
  });

  // Top spend drivers by (model, task_type) — same semantics as `!budget`'s
  // repo method (U-3).
  router.get("/api/dashboard/usage/drivers", async (req, res) => {
    const query = driversQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const since = query.data.since ?? startOfUtcMonth(new Date());
    const drivers = await deps.llmUsage.topDrivers(req.userId!, since, query.data.limit);
    res.json({
      since: since.toISOString(),
      drivers: drivers.map((d) => ({
        model: d.model,
        taskType: d.taskType,
        cost: money(d.costCents),
        calls: d.calls,
      })),
    });
  });

  return router;
}
