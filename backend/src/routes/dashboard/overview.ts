import { Router } from "express";
import { loadBudgetSnapshot } from "../../agent/budget.js";
import { DEGRADATION_DESCRIPTIONS } from "./degradation.js";
import type { DashboardDeps } from "./index.js";
import { money } from "./money.js";

/**
 * Overview endpoint (M4, PRD §4.2): the home page's KPI bundle composed from the
 * M1–M3 sources — spend + degradation (O-1..O-3), memory count and last write
 * (O-4), the last digest run (O-5), and service health (O-6). One request so the
 * page renders in a single round trip.
 */
export function overviewRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/overview", async (req, res) => {
    const userId = req.userId!;
    const [snapshot, memories, digest] = await Promise.all([
      loadBudgetSnapshot(deps, userId),
      deps.memories.listActive(userId),
      deps.digests.latestForUser(userId),
    ]);
    const digestItems = digest ? await deps.digestItems.listByDigest(digest.id) : [];

    res.json({
      spend: {
        today: money(snapshot.dailyCents),
        monthToDate: money(snapshot.monthToDateCents),
        monthlyCeiling:
          snapshot.monthlyCeilingCents > 0 ? money(snapshot.monthlyCeilingCents) : null,
        pctOfCeiling: snapshot.pctOfCeiling,
        degradation: {
          state: snapshot.state,
          description: DEGRADATION_DESCRIPTIONS[snapshot.state],
        },
      },
      memory: {
        // listActive is newest-first, so the first row is the latest write.
        activeCount: memories.length,
        lastWriteAt: memories[0]?.created_at.toISOString() ?? null,
      },
      digest: digest
        ? {
            runDate: digest.run_date,
            status: digest.status,
            cost: money(Number(digest.cost_cents)),
            deliveredAt: digest.delivered_at?.toISOString() ?? null,
            pickCount: digestItems.filter((i) => i.kind === "pick").length,
            // Why the last run failed, so the home page explains a red state instead of
            // just naming it (#83). Null unless the run failed.
            failure: digest.failure_kind
              ? { kind: digest.failure_kind, message: digest.failure_message ?? "" }
              : null,
          }
        : null,
      health: {
        // The KPI reads above hit Postgres, so a 200 already proves the DB.
        db: "ok",
        gateway: deps.gatewayStatus
          ? deps.gatewayStatus()
            ? "connected"
            : "disconnected"
          : "unknown",
      },
    });
  });

  return router;
}
