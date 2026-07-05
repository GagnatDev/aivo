// Types mirroring the dashboard overview API (backend routes/dashboard/overview.ts).

import type { DegradationState, Money } from "./usage.js";

export interface Overview {
  spend: {
    today: Money;
    monthToDate: Money;
    monthlyCeiling: Money | null;
    pctOfCeiling: number;
    degradation: { state: DegradationState; description: string };
  };
  memory: {
    activeCount: number;
    lastWriteAt: string | null;
  };
  digest: {
    runDate: string;
    status: "pending" | "delivered" | "skipped_budget";
    cost: Money;
    deliveredAt: string | null;
    pickCount: number;
  } | null;
  health: {
    db: "ok";
    gateway: "connected" | "disconnected" | "unknown";
  };
}

/** "Jun 5" / "Jun 5, 14:30" style short stamps for KPI details. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** Plain-language digest status for the last-run card (O-5). */
export const DIGEST_STATUS_LABELS: Record<NonNullable<Overview["digest"]>["status"], string> = {
  pending: "pending — run started but not delivered",
  delivered: "delivered",
  skipped_budget: "skipped — budget degraded",
};
