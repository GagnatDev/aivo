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

/** "07:00" from the digest hour. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "every day" / "every 3 days" for the digest cadence. */
export function formatInterval(days: number): string {
  return days === 1 ? "every day" : `every ${days} days`;
}
