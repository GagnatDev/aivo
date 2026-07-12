// Types mirroring the dashboard settings API (backend routes/dashboard/settings.ts).

import type { Money } from "./usage.js";

export interface SettingsBundle {
  digest: {
    /** Local delivery hour (0–23) in `timezone`. */
    hour: number;
    timezone: string;
    intervalDays: number;
    /** Max picks per digest. */
    cap: number;
    proactivity: {
      enabled: boolean;
      pausedUntil: string | null;
      runRequestedAt: string | null;
    };
  };
  modelTier: string;
  personaPrompt: string | null;
  budget: {
    monthlyCeiling: Money | null;
    dailySoftCap: Money | null;
    approvalThreshold: Money | null;
    alertThresholds: number[];
  };
}

/** The unforked meal-planner connection (backend routes/dashboard/unforked.ts). */
export interface UnforkedStatus {
  /** False until UNFORKED_BASE_URL is set on the deployment. */
  configured: boolean;
  /** True once an API key is registered (the key itself is never sent back). */
  connected: boolean;
  ownerEmail: string | null;
  keyName: string | null;
  verifiedAt: string | null;
}

/** "07:00" from the digest hour. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "every day" / "every 3 days" for the digest cadence. */
export function formatInterval(days: number): string {
  return days === 1 ? "every day" : `every ${days} days`;
}
