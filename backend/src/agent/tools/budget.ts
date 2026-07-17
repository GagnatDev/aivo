import { z } from "zod";
import { loadBudgetSnapshot } from "../budget.js";
import { OWNER_ONLY, parse, type AgentTool } from "./index.js";

const budgetArgs = z.object({
  action: z.enum(["report", "set_caps", "set_tier"]),
  monthly_ceiling_cents: z.number().int().nonnegative().optional(),
  daily_soft_cap_cents: z.number().int().nonnegative().nullable().optional(),
  approval_threshold_cents: z.number().int().nonnegative().nullable().optional(),
  tier: z.enum(["auto", "cheap", "premium"]).optional(),
});

export const budgetTool: AgentTool = {
  // Bilingual keyword gate (English + Norwegian, the owner's usual language) — see
  // reminders.ts and gate.ts. "$"/"€" are literal symbol triggers; "kr"/"tak"/"dyr" stay
  // whole-word (too short to stem safely, so suffixed forms are listed explicitly).
  gate: [
    "$",
    "€",
    "kr",
    "budget",
    "spend",
    "spent",
    "cost",
    "cap",
    "caps",
    "ceiling",
    "cents",
    "dollar",
    "euro",
    "money",
    "bill",
    "afford",
    "expensive",
    "threshold",
    "approval",
    "tier",
    "premium",
    "cheap",
    "budsjett",
    "brukt",
    "bruke",
    "kostnad",
    "koster",
    "penger",
    "kroner",
    "dyr",
    "dyrt",
    "dyre",
    "billig",
    "rimelig",
    "regning",
    "godkjenn",
    "grense",
    "tak",
  ],
  schema: {
    name: "budget",
    description:
      "Report spend or change budget settings. Call this whenever the conversation is about " +
      "aivo's own cost or budget — what's been spent ('how much have I spent?', 'hvor mye har " +
      "jeg brukt?'), what things cost, or changing caps/thresholds/tier ('set my cap to $20') — " +
      "never answer spend questions from memory. 'report' shows today's and month-to-date " +
      "spend vs the monthly ceiling plus top drivers (anyone). 'set_caps' updates caps and the " +
      "per-request approval threshold in whole cents ($15/mo = 1500); 'set_tier' forces the " +
      "model tier auto|cheap|premium. set_caps and set_tier are owner-only.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["report", "set_caps", "set_tier"] },
        monthly_ceiling_cents: { type: "integer", description: "whole cents (set_caps)" },
        daily_soft_cap_cents: { type: "integer", description: "whole cents or null (set_caps)" },
        approval_threshold_cents: {
          type: "integer",
          description: "whole cents or null (set_caps)",
        },
        tier: { type: "string", enum: ["auto", "cheap", "premium"], description: "set_tier" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(budgetArgs, args);
    if (!p.ok) return p.error;
    const { deps } = ctx;
    switch (p.value.action) {
      case "report": {
        const snap = await loadBudgetSnapshot(deps, ctx.userId);
        const drivers = await deps.llmUsage.topDrivers(ctx.userId, monthStart(deps.clock.now()));
        return JSON.stringify({
          today_cents: round(snap.dailyCents),
          month_to_date_cents: round(snap.monthToDateCents),
          monthly_ceiling_cents: snap.monthlyCeilingCents,
          pct_of_ceiling: Math.round(snap.pctOfCeiling),
          degradation_state: snap.state,
          top_drivers: drivers.map((d) => ({
            model: d.model,
            task: d.taskType,
            cents: round(d.costCents),
            calls: d.calls,
          })),
        });
      }
      case "set_caps": {
        if (!ctx.isOwner) return OWNER_ONLY;
        const row = await deps.budgetConfig.update(ctx.userId, {
          ...(p.value.monthly_ceiling_cents !== undefined
            ? { monthly_ceiling_cents: p.value.monthly_ceiling_cents }
            : {}),
          ...(p.value.daily_soft_cap_cents !== undefined
            ? { daily_soft_cap_cents: p.value.daily_soft_cap_cents }
            : {}),
          ...(p.value.approval_threshold_cents !== undefined
            ? { approval_threshold_cents: p.value.approval_threshold_cents }
            : {}),
        });
        return `Budget updated: ceiling ${row.monthly_ceiling_cents}¢, daily ${row.daily_soft_cap_cents ?? "—"}¢, approval ${row.approval_threshold_cents ?? "—"}¢.`;
      }
      case "set_tier": {
        if (!ctx.isOwner) return OWNER_ONLY;
        if (!p.value.tier) return "Provide a 'tier' (auto|cheap|premium).";
        const row = await deps.settings.update(ctx.userId, { model_tier: p.value.tier });
        return `Model tier set to ${row.model_tier}.`;
      }
    }
  },
};

function round(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}

/** UTC start-of-month for `now` — the window for month-to-date spend drivers. */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
