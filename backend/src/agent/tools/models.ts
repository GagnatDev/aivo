import { z } from "zod";
import { OWNER_ONLY, parse, type AgentTool } from "./index.js";

const modelsArgs = z.object({
  action: z.enum(["list", "set_price", "set_tier_role"]),
  model_id: z.string().optional(),
  input_cost_per_mtok_cents: z.number().nonnegative().optional(),
  output_cost_per_mtok_cents: z.number().nonnegative().optional(),
  role: z.enum(["cheap", "premium"]).optional(),
});

export const modelsTool: AgentTool = {
  gate: /\b(models?|prices?|pricing|scaleway|llama|mtok|per[- ]?token|tier|premium|cheap)\b/i,
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
        input_cost_per_mtok_cents: {
          type: "number",
          description: "cents per 1M input tokens (set_price)",
        },
        output_cost_per_mtok_cents: {
          type: "number",
          description: "cents per 1M output tokens (set_price)",
        },
        role: {
          type: "string",
          enum: ["cheap", "premium"],
          description: "tier to assign (set_tier_role)",
        },
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
