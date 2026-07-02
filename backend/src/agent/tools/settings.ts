import { z } from "zod";
import { OWNER_ONLY, parse, type AgentTool } from "./index.js";

// Columns a non-owner could be permitted to edit (the rest are reserved). The
// allow-list in settings_permissions intersects with this set.
const SETTINGS_PATCH_KEYS = [
  "timezone",
  "digest_hour",
  "digest_cap",
  "model_tier",
  "persona_prompt",
] as const;

const settingsArgs = z.object({
  action: z.enum(["get", "update", "set_member_editable_keys"]),
  timezone: z.string().optional(),
  digest_hour: z.number().int().min(0).max(23).optional(),
  digest_cap: z.number().int().positive().optional(),
  model_tier: z.enum(["auto", "cheap", "premium"]).optional(),
  persona_prompt: z.string().nullable().optional(),
  member_editable_keys: z.array(z.enum(SETTINGS_PATCH_KEYS)).optional(),
});

export const settingsTool: AgentTool = {
  gate: /\b(settings?|time ?zones?|digest|persona|preferences?|tier|member|editable)\b/i,
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
