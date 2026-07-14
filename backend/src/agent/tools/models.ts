import { z } from "zod";
import { OWNER_ONLY, parse, type AgentTool } from "./index.js";

const modelsArgs = z.object({
  action: z.enum(["list", "set_price", "set_tier_role"]),
  model_id: z.string().optional(),
  input_cost_per_mtok_cents: z.number().nonnegative().optional(),
  output_cost_per_mtok_cents: z.number().nonnegative().optional(),
  audio_cost_per_min_cents: z.number().nonnegative().optional(),
  capabilities: z.array(z.enum(["chat", "audio", "vision"])).optional(),
  role: z.enum(["cheap", "premium"]).optional(),
  capability: z.enum(["chat", "audio", "vision"]).optional(),
});

export const modelsTool: AgentTool = {
  // Bilingual keyword gate (English + Norwegian, the owner's usual language) — see
  // reminders.ts and gate.ts for how these match (exact/stem/fuzzy).
  gate: [
    "model",
    "modell",
    "price",
    "pricing",
    "pris",
    "scaleway",
    "llama",
    "whisper",
    "voxtral",
    "mtok",
    "per token",
    "tier",
    "premium",
    "cheap",
    "capabilit",
    "audio",
    "voice",
    "stemme",
    "tale",
    "lyd",
    "transcri",
  ],
  schema: {
    name: "models",
    description:
      "Inspect or configure the model/pricing table. 'list' shows models with their " +
      "capabilities (chat|audio|vision), the slots they fill (e.g. chat:cheap — aivo uses a " +
      "model only for slots it holds), token prices (cents per 1,000,000 tokens) and, for " +
      "audio models, the per-minute audio price (anyone). 'set_price' adds a model (new " +
      "model_id, optionally with capabilities and an audio per-minute price) or updates prices; " +
      "'set_tier_role' points a (capability, cheap|premium) slot at a model — pass 'capability' " +
      "when the model has several; one model may fill many slots. Audio models (e.g. Scaleway " +
      "whisper/voxtral) transcribe voice messages. set_price and set_tier_role are OWNER-ONLY: " +
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
        audio_cost_per_min_cents: {
          type: "number",
          description: "cents per minute of audio, for audio models (set_price)",
        },
        capabilities: {
          type: "array",
          items: { type: "string", enum: ["chat", "audio", "vision"] },
          description: "what the model can do; defaults to chat when adding a model (set_price)",
        },
        role: {
          type: "string",
          enum: ["cheap", "premium"],
          description: "tier slot to assign (set_tier_role)",
        },
        capability: {
          type: "string",
          enum: ["chat", "audio", "vision"],
          description:
            "which capability's slot to assign (set_tier_role); required when the model " +
            "declares more than one capability",
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
        const [rows, assignments] = await Promise.all([
          modelPricing.listActive(),
          modelPricing.listAssignments(),
        ]);
        return JSON.stringify(
          rows.map((r) => ({
            model_id: r.model_id,
            roles: assignments
              .filter((a) => a.model_id === r.model_id)
              .map((a) => `${a.capability}:${a.tier_role}`),
            capabilities: r.capabilities,
            input_cents_per_mtok: Number(r.input_cost_per_mtok_cents),
            output_cents_per_mtok: Number(r.output_cost_per_mtok_cents),
            audio_cents_per_min:
              r.audio_cost_per_min_cents != null ? Number(r.audio_cost_per_min_cents) : null,
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
          ...(p.value.capabilities ? { capabilities: p.value.capabilities } : {}),
          ...(p.value.audio_cost_per_min_cents !== undefined
            ? { audioCostPerMinCents: p.value.audio_cost_per_min_cents }
            : {}),
        });
        const audioNote =
          row.audio_cost_per_min_cents != null
            ? `, audio ${Number(row.audio_cost_per_min_cents)}¢/min`
            : "";
        return `Set ${row.model_id} pricing: in ${Number(row.input_cost_per_mtok_cents)}¢/Mtok, out ${Number(row.output_cost_per_mtok_cents)}¢/Mtok${audioNote}. Capabilities: ${row.capabilities.join(", ")}.`;
      }
      case "set_tier_role": {
        if (!ctx.isOwner) return OWNER_ONLY;
        if (!p.value.model_id || !p.value.role) return "Provide model_id and role (cheap|premium).";
        const result = await modelPricing.setTierRole(
          p.value.model_id,
          p.value.role,
          p.value.capability,
        );
        if (!result.ok) {
          switch (result.reason) {
            case "unknown_model":
              return "No such model id.";
            case "ambiguous_capability":
              return "That model has several capabilities — say which slot to assign (capability: chat|audio|vision).";
            case "capability_not_held":
              return "That model isn't declared capable of that — update its capabilities via set_price first if it really is.";
          }
        }
        return `${result.row.model_id} is now the ${p.value.role} ${result.capability} model.`;
      }
    }
  },
};
