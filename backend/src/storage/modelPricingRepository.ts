import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { ModelCapability, ModelTierRole } from "../db/schema.enums.js";

export interface ModelPricingRow {
  id: string;
  model_id: string;
  tier_role: ModelTierRole | null;
  /** What the model can do (chat | audio | vision) — the modality axis, orthogonal to tier. */
  capabilities: ModelCapability[];
  /** Cents per 1,000,000 input tokens. */
  input_cost_per_mtok_cents: string;
  /** Cents per 1,000,000 output tokens. */
  output_cost_per_mtok_cents: string;
  /** Cents per minute of audio — set only on audio models (null otherwise). */
  audio_cost_per_min_cents: string | null;
  currency: string;
  active: boolean;
}

const PRICING_COLUMNS = [
  "id",
  "model_id",
  "tier_role",
  "capabilities",
  "input_cost_per_mtok_cents",
  "output_cost_per_mtok_cents",
  "audio_cost_per_min_cents",
  "currency",
  "active",
] as const;

/** A `capabilities @> ["<capability>"]` predicate — the DB filter for "can do X". */
function hasCapability(capability: ModelCapability) {
  return sql<boolean>`capabilities @> ${JSON.stringify([capability])}::jsonb`;
}

/**
 * DB-backed model + pricing config. Reads are open to the agent; the mutating
 * methods here are only ever reached after the models tool has verified the caller
 * is the owner. `tier_role` resolves which model id is cheap vs premium.
 */
export class ModelPricingRepository {
  constructor(private readonly db: Db) {}

  /** All active models, premium first then cheap, for the agent to inspect. */
  listActive(): Promise<ModelPricingRow[]> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("active", "=", true)
      .orderBy("tier_role", "asc")
      .orderBy("model_id", "asc")
      .execute();
  }

  /**
   * The active model filling a tier role (cheap/premium) for a given capability, if any.
   * Defaults to `chat` so every existing caller (chat turn, digest stages) implicitly
   * resolves a chat-capable model and can never pick a transcription-only model. Audio
   * resolution passes `"audio"`.
   */
  getByTier(
    role: ModelTierRole,
    capability: ModelCapability = "chat",
  ): Promise<ModelPricingRow | undefined> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("tier_role", "=", role)
      .where("active", "=", true)
      .where(hasCapability(capability))
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
   * `audioCostPerMinCents` is set only for audio models. `capabilities` is applied on
   * insert (defaults to the DB's `["chat"]`); an existing row's capabilities are updated
   * only when the caller passes them explicitly, so a plain price refresh never changes
   * what a model is declared able to do.
   */
  async upsertModel(input: {
    modelId: string;
    inputCostPerMtokCents: number;
    outputCostPerMtokCents: number;
    currency?: string;
    capabilities?: ModelCapability[];
    audioCostPerMinCents?: number | null;
  }): Promise<ModelPricingRow> {
    const audioProvided = input.audioCostPerMinCents !== undefined;
    const row = await this.db
      .insertInto("model_pricing")
      .values({
        model_id: input.modelId,
        input_cost_per_mtok_cents: input.inputCostPerMtokCents,
        output_cost_per_mtok_cents: input.outputCostPerMtokCents,
        currency: input.currency ?? "EUR",
        ...(input.capabilities ? { capabilities: JSON.stringify(input.capabilities) } : {}),
        ...(audioProvided ? { audio_cost_per_min_cents: input.audioCostPerMinCents } : {}),
      })
      .onConflict((oc) =>
        oc.column("model_id").doUpdateSet({
          input_cost_per_mtok_cents: input.inputCostPerMtokCents,
          output_cost_per_mtok_cents: input.outputCostPerMtokCents,
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.capabilities ? { capabilities: JSON.stringify(input.capabilities) } : {}),
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
   * Assign a tier role (cheap/premium) to a model. The role is unique *per capability
   * domain* (one cheap + one premium chat model, and independently one cheap + one
   * premium audio model — see the two partial unique indexes in migration 021), so we
   * first clear the role from any other model that shares a capability domain with the
   * target, matching exactly what those indexes constrain. Done in a transaction so the
   * swap is atomic. Returns the updated row, or undefined if the model id is unknown.
   */
  async setTierRole(modelId: string, role: ModelTierRole): Promise<ModelPricingRow | undefined> {
    return this.db.transaction().execute(async (tx) => {
      const target = await tx
        .selectFrom("model_pricing")
        .select("capabilities")
        .where("model_id", "=", modelId)
        .executeTakeFirst();
      if (!target) return undefined;

      // Clear the role only within the target's capability domain(s): assigning the
      // premium *audio* model must not strip the premium *chat* model, and vice versa.
      await tx
        .updateTable("model_pricing")
        .set({ tier_role: null, updated_at: sql`now()` })
        .where("tier_role", "=", role)
        .where("model_id", "!=", modelId)
        .where((eb) => eb.or(target.capabilities.map((c) => hasCapability(c))))
        .execute();

      return tx
        .updateTable("model_pricing")
        .set({ tier_role: role, active: true, updated_at: sql`now()` })
        .where("model_id", "=", modelId)
        .returning(PRICING_COLUMNS)
        .executeTakeFirst();
    });
  }
}
