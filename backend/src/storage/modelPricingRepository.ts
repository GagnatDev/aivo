import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { ModelCapability, ModelTierRole } from "../db/schema.enums.js";

export interface ModelPricingRow {
  id: string;
  model_id: string;
  /** What the model can do (chat | audio | vision) — metadata; usage is assigned separately. */
  capabilities: ModelCapability[];
  /** Cents per 1,000,000 input tokens. */
  input_cost_per_mtok_cents: string;
  /**
   * Cents per 1,000,000 input tokens served from the provider's prompt cache; null when
   * the model has no known cache discount (cache hits then bill at the input price).
   */
  cached_input_cost_per_mtok_cents: string | null;
  /** Cents per 1,000,000 output tokens. */
  output_cost_per_mtok_cents: string;
  /** Cents per minute of audio — set only on audio models (null otherwise). */
  audio_cost_per_min_cents: string | null;
  currency: string;
  active: boolean;
}

/** One filled slot: "the <tier_role> <capability> model is <model_id>". */
export interface TierAssignment {
  capability: ModelCapability;
  tier_role: ModelTierRole;
  model_id: string;
}

/** Why a setTierRole call was refused, for the models tool to phrase a reply. */
export type SetTierRoleResult =
  | { ok: true; row: ModelPricingRow; capability: ModelCapability }
  | { ok: false; reason: "unknown_model" | "ambiguous_capability" | "capability_not_held" };

const PRICING_COLUMNS = [
  "id",
  "model_id",
  "capabilities",
  "input_cost_per_mtok_cents",
  "cached_input_cost_per_mtok_cents",
  "output_cost_per_mtok_cents",
  "audio_cost_per_min_cents",
  "currency",
  "active",
] as const;

/**
 * DB-backed model + pricing config. model_pricing holds facts about each model
 * (capabilities, prices); model_tier_assignments holds which model fills each
 * (capability, tier_role) slot — see migration 021. Reads are open to the agent; the
 * mutating methods here are only ever reached after the models tool has verified the
 * caller is the owner.
 */
export class ModelPricingRepository {
  constructor(private readonly db: Db) {}

  /** All active models, for the agent and dashboard to inspect. */
  listActive(): Promise<ModelPricingRow[]> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("active", "=", true)
      .orderBy("model_id", "asc")
      .execute();
  }

  /** Every filled slot, for display (models tool list, dashboard, !models). */
  listAssignments(): Promise<TierAssignment[]> {
    return this.db
      .selectFrom("model_tier_assignments")
      .select(["capability", "tier_role", "model_id"])
      .orderBy("capability", "asc")
      .orderBy("tier_role", "asc")
      .execute();
  }

  /**
   * The active model filling a slot, if any. Defaults to `chat` so every existing
   * caller (chat turn, digest stages) implicitly resolves the chat slot and can never
   * pick a transcription-only model. Audio resolution passes `"audio"`.
   */
  getByTier(
    role: ModelTierRole,
    capability: ModelCapability = "chat",
  ): Promise<ModelPricingRow | undefined> {
    return this.db
      .selectFrom("model_tier_assignments as a")
      .innerJoin("model_pricing as p", "p.model_id", "a.model_id")
      .select([
        "p.id",
        "p.model_id",
        "p.capabilities",
        "p.input_cost_per_mtok_cents",
        "p.cached_input_cost_per_mtok_cents",
        "p.output_cost_per_mtok_cents",
        "p.audio_cost_per_min_cents",
        "p.currency",
        "p.active",
      ])
      .where("a.tier_role", "=", role)
      .where("a.capability", "=", capability)
      .where("p.active", "=", true)
      .executeTakeFirst();
  }

  getByModelId(modelId: string): Promise<ModelPricingRow | undefined> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("model_id", "=", modelId)
      .executeTakeFirst();
  }

  /**
   * Upsert a model and its prices (owner-only path). Prices are cents per Mtok;
   * `cachedInputCostPerMtokCents` (prompt-cache hit price) and `audioCostPerMinCents`
   * are touched only when passed, so a plain in/out refresh never clears them. `capabilities` is applied on
   * insert (defaults to the DB's `["chat"]`); an existing row's capabilities are updated
   * only when the caller passes them explicitly, so a plain price refresh never changes
   * what a model is declared able to do. Never touches slot assignments.
   */
  async upsertModel(input: {
    modelId: string;
    inputCostPerMtokCents: number;
    outputCostPerMtokCents: number;
    currency?: string;
    capabilities?: ModelCapability[];
    cachedInputCostPerMtokCents?: number | null;
    audioCostPerMinCents?: number | null;
  }): Promise<ModelPricingRow> {
    const cachedProvided = input.cachedInputCostPerMtokCents !== undefined;
    const audioProvided = input.audioCostPerMinCents !== undefined;
    const row = await this.db
      .insertInto("model_pricing")
      .values({
        model_id: input.modelId,
        input_cost_per_mtok_cents: input.inputCostPerMtokCents,
        output_cost_per_mtok_cents: input.outputCostPerMtokCents,
        currency: input.currency ?? "EUR",
        ...(input.capabilities ? { capabilities: JSON.stringify(input.capabilities) } : {}),
        ...(cachedProvided
          ? { cached_input_cost_per_mtok_cents: input.cachedInputCostPerMtokCents }
          : {}),
        ...(audioProvided ? { audio_cost_per_min_cents: input.audioCostPerMinCents } : {}),
      })
      .onConflict((oc) =>
        oc.column("model_id").doUpdateSet({
          input_cost_per_mtok_cents: input.inputCostPerMtokCents,
          output_cost_per_mtok_cents: input.outputCostPerMtokCents,
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.capabilities ? { capabilities: JSON.stringify(input.capabilities) } : {}),
          ...(cachedProvided
            ? { cached_input_cost_per_mtok_cents: input.cachedInputCostPerMtokCents }
            : {}),
          ...(audioProvided ? { audio_cost_per_min_cents: input.audioCostPerMinCents } : {}),
          updated_at: sql`now()`,
        }),
      )
      .returning(PRICING_COLUMNS)
      .executeTakeFirstOrThrow();
    return row;
  }

  /** Update just the prices of an existing model. Returns undefined if unknown. */
  async updatePricing(
    modelId: string,
    prices: { inputCostPerMtokCents: number; outputCostPerMtokCents: number },
  ): Promise<ModelPricingRow | undefined> {
    return this.db
      .updateTable("model_pricing")
      .set({
        input_cost_per_mtok_cents: prices.inputCostPerMtokCents,
        output_cost_per_mtok_cents: prices.outputCostPerMtokCents,
        updated_at: sql`now()`,
      })
      .where("model_id", "=", modelId)
      .returning(PRICING_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Point a slot at a model: "make <modelId> the <role> <capability> model". The slot's
   * primary key makes the swap a single upsert — whoever previously filled the slot
   * simply stops being referenced, and no other slot is touched (a model may keep
   * filling several). `capability` may be omitted when the model declares exactly one;
   * with several it must be explicit, and a capability the model doesn't declare is
   * refused — the guardrail that stops a chat-only model landing in an audio slot.
   * Assigning also reactivates the model, matching the pre-021 behavior.
   */
  async setTierRole(
    modelId: string,
    role: ModelTierRole,
    capability?: ModelCapability,
  ): Promise<SetTierRoleResult> {
    const target = await this.getByModelId(modelId);
    if (!target) return { ok: false, reason: "unknown_model" };

    const resolved =
      capability ?? (target.capabilities.length === 1 ? target.capabilities[0] : undefined);
    if (!resolved) return { ok: false, reason: "ambiguous_capability" };
    if (!target.capabilities.includes(resolved))
      return { ok: false, reason: "capability_not_held" };

    const row = await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("model_tier_assignments")
        .values({ capability: resolved, tier_role: role, model_id: modelId })
        .onConflict((oc) =>
          oc
            .columns(["capability", "tier_role"])
            .doUpdateSet({ model_id: modelId, updated_at: sql`now()` }),
        )
        .execute();
      return tx
        .updateTable("model_pricing")
        .set({ active: true, updated_at: sql`now()` })
        .where("model_id", "=", modelId)
        .returning(PRICING_COLUMNS)
        .executeTakeFirstOrThrow();
    });
    return { ok: true, row, capability: resolved };
  }
}
