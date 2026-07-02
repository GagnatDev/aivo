import { afterEach, describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { ModelPricingRepository } from "../../storage/modelPricingRepository.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { testDb, useCleanDb } from "../../test/db.js";

useCleanDb();

const registry = buildToolRegistry();
const tool = (name: string): AgentTool => {
  const t = registry.find((x) => x.schema.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

async function ctxFor(discordId: string): Promise<ToolContext> {
  const deps = makeAgentDeps();
  const { userId, isOwner, conversationId } = await provisionUser(deps, discordId);
  return { deps, userId, isOwner, conversationId };
}

// model_pricing is not user-scoped; restore the seed after tests that mutate it.
afterEach(async () => {
  const repo = new ModelPricingRepository(testDb());
  await repo.upsertModel({
    modelId: "llama-3.1-8b-instruct",
    inputCostPerMtokCents: 20,
    outputCostPerMtokCents: 20,
  });
  await repo.upsertModel({
    modelId: "llama-3.3-70b-instruct",
    inputCostPerMtokCents: 90,
    outputCostPerMtokCents: 90,
  });
  await repo.setTierRole("llama-3.1-8b-instruct", "cheap");
  await repo.setTierRole("llama-3.3-70b-instruct", "premium");
});

describe("models tool authorization", () => {
  it("lets the owner set a price", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool("models").execute(
      {
        action: "set_price",
        model_id: "llama-3.3-70b-instruct",
        input_cost_per_mtok_cents: 100,
        output_cost_per_mtok_cents: 200,
      },
      ctx,
    );
    expect(res).toMatch(/100/);
    const row = await ctx.deps.modelPricing.getByModelId("llama-3.3-70b-instruct");
    expect(Number(row?.input_cost_per_mtok_cents)).toBe(100);
  });

  it("refuses a non-owner set_price and makes no change", async () => {
    const ctx = await ctxFor("not-the-owner");
    const before = await ctx.deps.modelPricing.getByModelId("llama-3.3-70b-instruct");
    const res = await tool("models").execute(
      {
        action: "set_price",
        model_id: "llama-3.3-70b-instruct",
        input_cost_per_mtok_cents: 1,
        output_cost_per_mtok_cents: 1,
      },
      ctx,
    );
    expect(res).toMatch(/Refused/);
    const after = await ctx.deps.modelPricing.getByModelId("llama-3.3-70b-instruct");
    expect(after?.input_cost_per_mtok_cents).toBe(before?.input_cost_per_mtok_cents);
  });

  it("allows anyone to list", async () => {
    const ctx = await ctxFor("not-the-owner");
    const rows = JSON.parse(await tool("models").execute({ action: "list" }, ctx));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
