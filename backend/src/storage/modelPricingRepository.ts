import { sql } from "kysely";
import type { Db } from "../db/kysely.js";
import type { ModelTierRole } from "../db/schema.enums.js";

export interface ModelPricingRow {
  id: string;
  model_id: string;
  tier_role: ModelTierRole | null;
  /** Cents per 1,000,000 input tokens. */
  input_cost_per_mtok_cents: string;
  /** Cents per 1,000,000 output tokens. */
  output_cost_per_mtok_cents: string;
  currency: string;
  active: boolean;
}

const PRICING_COLUMNS = [
  "id",
  "model_id",
  "tier_role",
  "input_cost_per_mtok_cents",
  "output_cost_per_mtok_cents",
  "currency",
  "active",
] as const;

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

  /** The active model filling a tier role (cheap/premium), if any. */
  getByTier(role: ModelTierRole): Promise<ModelPricingRow | undefined> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("tier_role", "=", role)
      .where("active", "=", true)
      .executeTakeFirst();
  }

  getByModelId(modelId: string): Promise<ModelPricingRow | undefined> {
    return this.db
      .selectFrom("model_pricing")
      .select(PRICING_COLUMNS)
      .where("model_id", "=", modelId)
      .executeTakeFirst();
  }

  /** Upsert a model and its prices (owner-only path). Prices are cents per Mtok. */
  async upsertModel(input: {
    modelId: string;
    inputCostPerMtokCents: number;
    outputCostPerMtokCents: number;
    currency?: string;
  }): Promise<ModelPricingRow> {
    const row = await this.db
      .insertInto("model_pricing")
      .values({
        model_id: input.modelId,
        input_cost_per_mtok_cents: input.inputCostPerMtokCents,
        output_cost_per_mtok_cents: input.outputCostPerMtokCents,
        currency: input.currency ?? "EUR",
      })
      .onConflict((oc) =>
        oc.column("model_id").doUpdateSet({
          input_cost_per_mtok_cents: input.inputCostPerMtokCents,
          output_cost_per_mtok_cents: input.outputCostPerMtokCents,
          ...(input.currency ? { currency: input.currency } : {}),
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
   * Assign a tier role (cheap/premium) to a model. The partial unique index allows
   * only one model per role, so we first clear the role from whatever model currently
   * holds it — done in a transaction so the swap is atomic. Returns the updated row,
   * or undefined if the model id is unknown.
   */
  async setTierRole(modelId: string, role: ModelTierRole): Promise<ModelPricingRow | undefined> {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("model_pricing")
        .set({ tier_role: null, updated_at: sql`now()` })
        .where("tier_role", "=", role)
        .where("model_id", "!=", modelId)
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
