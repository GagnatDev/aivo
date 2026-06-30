import { z } from "zod";
import type { ToolSchema } from "../llm/provider.js";
import type { ModelTierRole } from "../db/schema.js";
import { loadBudgetSnapshot, type Tier } from "./budget.js";
import type { AgentDeps } from "./deps.js";

/** The execution context handed to every tool. `isOwner` is the security boundary. */
export interface ToolContext {
  deps: AgentDeps;
  userId: string;
  /** Derived server-side from users.is_owner — never from model output. */
  isOwner: boolean;
  conversationId: string;
}

export interface AgentTool {
  schema: ToolSchema;
  /** Execute the call and return a result string appended as a `tool` message. */
  execute(args: unknown, ctx: ToolContext): Promise<string>;
}

/** Standard refusal when a non-owner attempts an owner-only action. */
const OWNER_ONLY = "Refused: only the owner can do that.";

/** Parse args with a Zod schema, returning a tagged error the model can recover from. */
function parse<T>(schema: z.ZodType<T>, args: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const result = schema.safeParse(args);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: `Invalid arguments: ${result.error.issues.map((i) => i.message).join("; ")}` };
}

const memoryArgs = z.object({
  action: z.enum(["list", "search", "write", "forget"]),
  term: z.string().optional(),
  content: z.string().optional(),
  category: z.enum(["preference", "fact", "context"]).optional(),
  id: z.string().optional(),
});

const memoryTool: AgentTool = {
  schema: {
    name: "memory",
    description:
      "Read, write, or forget durable facts/preferences/context about the user. " +
      "Use action 'list' for 'what do you remember about me?', 'search' to find by keyword, " +
      "'write' to remember something new, and 'forget' (with the memory id from a list/search) " +
      "to soft-delete a memory.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "search", "write", "forget"] },
        term: { type: "string", description: "keyword query (action=search)" },
        content: { type: "string", description: "the memory text (action=write)" },
        category: {
          type: "string",
          enum: ["preference", "fact", "context"],
          description: "kind of memory (action=write)",
        },
        id: { type: "string", description: "memory id to forget (action=forget)" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(memoryArgs, args);
    if (!p.ok) return p.error;
    const { memories } = ctx.deps;
    switch (p.value.action) {
      case "list": {
        const rows = await memories.listActive(ctx.userId);
        return JSON.stringify(rows.map((m) => ({ id: m.id, category: m.category, content: m.content })));
      }
      case "search": {
        if (!p.value.term) return "Provide a 'term' to search.";
        const rows = await memories.search(ctx.userId, p.value.term);
        return JSON.stringify(rows.map((m) => ({ id: m.id, category: m.category, content: m.content })));
      }
      case "write": {
        if (!p.value.content) return "Provide 'content' to remember.";
        const row = await memories.insert({
          userId: ctx.userId,
          content: p.value.content,
          category: p.value.category ?? null,
          source: "chat",
        });
        return `Remembered (id ${row.id}).`;
      }
      case "forget": {
        if (!p.value.id) return "Provide the 'id' of the memory to forget.";
        const row = await memories.forget(p.value.id, ctx.userId);
        return row ? `Forgotten (id ${p.value.id}).` : "No such active memory to forget.";
      }
    }
  },
};

const budgetArgs = z.object({
  action: z.enum(["report", "set_caps", "set_tier"]),
  monthly_ceiling_cents: z.number().int().nonnegative().optional(),
  daily_soft_cap_cents: z.number().int().nonnegative().nullable().optional(),
  approval_threshold_cents: z.number().int().nonnegative().nullable().optional(),
  tier: z.enum(["auto", "cheap", "premium"]).optional(),
});

const budgetTool: AgentTool = {
  schema: {
    name: "budget",
    description:
      "Report spend or change budget settings. 'report' shows today's and month-to-date spend " +
      "vs the monthly ceiling plus top drivers (anyone). 'set_caps' updates caps and the " +
      "per-request approval threshold in whole cents ($15/mo = 1500); 'set_tier' forces the " +
      "model tier auto|cheap|premium. set_caps and set_tier are owner-only.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["report", "set_caps", "set_tier"] },
        monthly_ceiling_cents: { type: "integer", description: "whole cents (set_caps)" },
        daily_soft_cap_cents: { type: "integer", description: "whole cents or null (set_caps)" },
        approval_threshold_cents: { type: "integer", description: "whole cents or null (set_caps)" },
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
        const drivers = await deps.llmUsage.topDrivers(ctx.userId, monthStart());
        return JSON.stringify({
          today_cents: round(snap.dailyCents),
          month_to_date_cents: round(snap.monthToDateCents),
          monthly_ceiling_cents: snap.monthlyCeilingCents,
          pct_of_ceiling: Math.round(snap.pctOfCeiling),
          degradation_state: snap.state,
          top_drivers: drivers.map((d) => ({ model: d.model, task: d.taskType, cents: round(d.costCents), calls: d.calls })),
        });
      }
      case "set_caps": {
        if (!ctx.isOwner) return OWNER_ONLY;
        const row = await deps.budgetConfig.update(ctx.userId, {
          ...(p.value.monthly_ceiling_cents !== undefined ? { monthly_ceiling_cents: p.value.monthly_ceiling_cents } : {}),
          ...(p.value.daily_soft_cap_cents !== undefined ? { daily_soft_cap_cents: p.value.daily_soft_cap_cents } : {}),
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

const modelsArgs = z.object({
  action: z.enum(["list", "set_price", "set_tier_role"]),
  model_id: z.string().optional(),
  input_cost_per_mtok_cents: z.number().nonnegative().optional(),
  output_cost_per_mtok_cents: z.number().nonnegative().optional(),
  role: z.enum(["cheap", "premium"]).optional(),
});

const modelsTool: AgentTool = {
  schema: {
    name: "models",
    description:
      "Inspect or configure the model/pricing table. 'list' shows models, their cheap/premium " +
      "role, and prices in cents per 1,000,000 tokens (anyone). 'set_price' adds a model (new " +
      "model_id) or updates its prices; 'set_tier_role' assigns the cheap/premium role (a model " +
      "is used for chat only once it holds a role). set_price and set_tier_role are OWNER-ONLY: " +
      "call them only when the owner explicitly asks. You cannot look up prices — never guess or " +
      "invent them; pass only figures the owner stated exactly, and ask if you don't have them.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set_price", "set_tier_role"] },
        model_id: { type: "string", description: "the provider's model id" },
        input_cost_per_mtok_cents: { type: "number", description: "cents per 1M input tokens (set_price)" },
        output_cost_per_mtok_cents: { type: "number", description: "cents per 1M output tokens (set_price)" },
        role: { type: "string", enum: ["cheap", "premium"], description: "tier to assign (set_tier_role)" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(modelsArgs, args);
    if (!p.ok) return p.error;
    const { modelPricing } = ctx.deps;
    switch (p.value.action) {
      case "list": {
        const rows = await modelPricing.listActive();
        return JSON.stringify(
          rows.map((r) => ({
            model_id: r.model_id,
            role: r.tier_role,
            input_cents_per_mtok: Number(r.input_cost_per_mtok_cents),
            output_cents_per_mtok: Number(r.output_cost_per_mtok_cents),
            currency: r.currency,
          })),
        );
      }
      case "set_price": {
        if (!ctx.isOwner) return OWNER_ONLY;
        if (
          !p.value.model_id ||
          p.value.input_cost_per_mtok_cents === undefined ||
          p.value.output_cost_per_mtok_cents === undefined
        ) {
          return "Provide model_id, input_cost_per_mtok_cents, and output_cost_per_mtok_cents.";
        }
        const row = await modelPricing.upsertModel({
          modelId: p.value.model_id,
          inputCostPerMtokCents: p.value.input_cost_per_mtok_cents,
          outputCostPerMtokCents: p.value.output_cost_per_mtok_cents,
        });
        return `Set ${row.model_id} pricing: in ${Number(row.input_cost_per_mtok_cents)}¢/Mtok, out ${Number(row.output_cost_per_mtok_cents)}¢/Mtok.`;
      }
      case "set_tier_role": {
        if (!ctx.isOwner) return OWNER_ONLY;
        if (!p.value.model_id || !p.value.role) return "Provide model_id and role (cheap|premium).";
        const row = await modelPricing.setTierRole(p.value.model_id, p.value.role);
        return row ? `${row.model_id} is now the ${row.tier_role} model.` : "No such model id.";
      }
    }
  },
};

// Columns a non-owner could be permitted to edit (the rest are reserved). The
// allow-list in settings_permissions intersects with this set.
const SETTINGS_PATCH_KEYS = ["timezone", "digest_hour", "digest_cap", "model_tier", "persona_prompt"] as const;

const settingsArgs = z.object({
  action: z.enum(["get", "update", "set_member_editable_keys"]),
  timezone: z.string().optional(),
  digest_hour: z.number().int().min(0).max(23).optional(),
  digest_cap: z.number().int().positive().optional(),
  model_tier: z.enum(["auto", "cheap", "premium"]).optional(),
  persona_prompt: z.string().nullable().optional(),
  member_editable_keys: z.array(z.enum(SETTINGS_PATCH_KEYS)).optional(),
});

const settingsTool: AgentTool = {
  schema: {
    name: "settings",
    description:
      "Read or change the user's settings (persona_prompt addendum, timezone, digest_hour, " +
      "digest_cap, model_tier). action 'get' returns the current settings; 'update' changes " +
      "one or more of them. A non-owner may only change keys the owner has allow-listed. " +
      "'set_member_editable_keys' replaces that allow-list and is OWNER-ONLY.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "update", "set_member_editable_keys"] },
        timezone: { type: "string" },
        digest_hour: { type: "integer" },
        digest_cap: { type: "integer" },
        model_tier: { type: "string", enum: ["auto", "cheap", "premium"] },
        persona_prompt: { type: "string" },
        member_editable_keys: {
          type: "array",
          items: { type: "string", enum: SETTINGS_PATCH_KEYS as unknown as string[] },
          description: "keys non-owners may edit (set_member_editable_keys)",
        },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(settingsArgs, args);
    if (!p.ok) return p.error;
    const { deps } = ctx;

    if (p.value.action === "get") {
      const row = await deps.settings.getOrCreate(ctx.userId);
      return JSON.stringify({
        timezone: row.timezone,
        digest_hour: row.digest_hour,
        digest_cap: row.digest_cap,
        model_tier: row.model_tier,
        persona_prompt: row.persona_prompt,
      });
    }

    if (p.value.action === "set_member_editable_keys") {
      if (!ctx.isOwner) return OWNER_ONLY;
      if (!p.value.member_editable_keys) return "Provide member_editable_keys (an array).";
      const keys = await deps.settingsPermissions.setKeys(p.value.member_editable_keys);
      return `Members may now edit: ${keys.length ? keys.join(", ") : "(nothing)"}.`;
    }

    // action === "update": collect the provided patch keys.
    const patch: Record<string, unknown> = {};
    for (const key of SETTINGS_PATCH_KEYS) {
      if (p.value[key] !== undefined) patch[key] = p.value[key];
    }
    if (Object.keys(patch).length === 0) return "Provide at least one setting to update.";

    if (!ctx.isOwner) {
      const { memberEditableKeys } = await deps.settingsPermissions.get();
      const disallowed = Object.keys(patch).filter((k) => !memberEditableKeys.includes(k));
      if (disallowed.length) return `Refused: you may not change ${disallowed.join(", ")}.`;
    }

    const row = await deps.settings.update(ctx.userId, patch);
    return `Settings updated. Current model_tier=${row.model_tier}, timezone=${row.timezone}.`;
  },
};

/** Build the tool registry the agent exposes (memory, budget, models, settings). */
export function buildToolRegistry(): AgentTool[] {
  return [memoryTool, budgetTool, modelsTool, settingsTool];
}

/** Resolve a tier setting/string to a concrete cheap|premium tier. `auto` → premium. */
export function resolveTier(modelTier: string): Tier {
  if (modelTier === "cheap") return "cheap";
  if (modelTier === "premium") return "premium";
  return "premium"; // auto: premium for real conversation (cheap is for ranking/classification)
}

function round(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Re-exported for type users.
export type { ModelTierRole };
