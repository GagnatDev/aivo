import { afterEach, describe, expect, it } from "vitest";
import {
  buildToolRegistry,
  resolveTier,
  selectToolSchemas,
  type AgentTool,
  type ToolContext,
} from "./tools.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { testDb, useCleanDb } from "../test/db.js";

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
  await repo.upsertModel({ modelId: "llama-3.1-8b-instruct", inputCostPerMtokCents: 20, outputCostPerMtokCents: 20 });
  await repo.upsertModel({ modelId: "llama-3.3-70b-instruct", inputCostPerMtokCents: 90, outputCostPerMtokCents: 90 });
  await repo.setTierRole("llama-3.1-8b-instruct", "cheap");
  await repo.setTierRole("llama-3.3-70b-instruct", "premium");
});

describe("resolveTier", () => {
  it("maps auto and unknown to premium, honors explicit tiers", () => {
    expect(resolveTier("auto")).toBe("premium");
    expect(resolveTier("cheap")).toBe("cheap");
    expect(resolveTier("premium")).toBe("premium");
  });
});

describe("memory tool", () => {
  it("writes then lists a memory", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const write = await tool("memory").execute({ action: "write", content: "likes tea" }, ctx);
    expect(write).toMatch(/Remembered/);
    const list = JSON.parse(await tool("memory").execute({ action: "list" }, ctx));
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("likes tea");
  });
});

describe("models tool authorization", () => {
  it("lets the owner set a price", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool("models").execute(
      { action: "set_price", model_id: "llama-3.3-70b-instruct", input_cost_per_mtok_cents: 100, output_cost_per_mtok_cents: 200 },
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
      { action: "set_price", model_id: "llama-3.3-70b-instruct", input_cost_per_mtok_cents: 1, output_cost_per_mtok_cents: 1 },
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

describe("settings tool permissions", () => {
  it("lets the owner change any setting", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool("settings").execute({ action: "update", timezone: "America/New_York" }, ctx);
    expect(res).toMatch(/America\/New_York/);
  });

  it("blocks a non-owner from a non-allow-listed key", async () => {
    const ctx = await ctxFor("member-2");
    // Default allow-list is ["persona_prompt"], so timezone is blocked.
    const res = await tool("settings").execute({ action: "update", timezone: "UTC" }, ctx);
    expect(res).toMatch(/Refused/);
  });

  it("allows a non-owner to change an allow-listed key", async () => {
    const ctx = await ctxFor("member-3");
    const res = await tool("settings").execute({ action: "update", persona_prompt: "be terse" }, ctx);
    expect(res).toMatch(/Settings updated/);
  });

  it("refuses a non-owner managing the allow-list", async () => {
    const ctx = await ctxFor("member-4");
    const res = await tool("settings").execute(
      { action: "set_member_editable_keys", member_editable_keys: ["timezone"] },
      ctx,
    );
    expect(res).toMatch(/Refused/);
  });
});

describe("budget tool", () => {
  it("reports spend for anyone", async () => {
    const ctx = await ctxFor("member-5");
    const report = JSON.parse(await tool("budget").execute({ action: "report" }, ctx));
    expect(report).toHaveProperty("month_to_date_cents");
    expect(report).toHaveProperty("degradation_state");
  });

  it("refuses a non-owner setting caps", async () => {
    const ctx = await ctxFor("member-6");
    const res = await tool("budget").execute({ action: "set_caps", monthly_ceiling_cents: 5000 }, ctx);
    expect(res).toMatch(/Refused/);
  });

  it("lets the owner set caps", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const res = await tool("budget").execute({ action: "set_caps", monthly_ceiling_cents: 5000 }, ctx);
    expect(res).toMatch(/5000/);
  });

  it("scopes report drivers to the injected clock's month", async () => {
    // The month-to-date driver window is derived from deps.clock.now(), so a fake
    // clock makes it deterministic. A usage row recorded "now" (DB time) is in this
    // month's window when the clock reads this month, and out of it when the clock is
    // advanced to a later month — with no dependence on the wall clock.
    const clock = new FakeClock();
    const deps = makeAgentDeps(makeFakeLlm([]), {}, clock);
    const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
    const ctx: ToolContext = { deps, userId, isOwner, conversationId };
    await deps.llmUsage.insert({
      userId,
      taskType: "chat",
      model: "llama-3.1-8b-instruct",
      tokensIn: 1000,
      tokensOut: 1000,
      costCents: 5,
    });

    // The row is created with the DB's `now()`, so anchor the clock to real time.
    const nowInstant = new Date();
    clock.set(nowInstant);
    const thisMonth = JSON.parse(await tool("budget").execute({ action: "report" }, ctx));
    expect(thisMonth.top_drivers).toHaveLength(1);

    // Advance ~2 months: monthStart() now sits after the row, so it drops out.
    clock.set(new Date(Date.UTC(nowInstant.getUTCFullYear(), nowInstant.getUTCMonth() + 2, 1)));
    const laterMonth = JSON.parse(await tool("budget").execute({ action: "report" }, ctx));
    expect(laterMonth.top_drivers).toHaveLength(0);
  });
});

describe("selectToolSchemas", () => {
  const reg = buildToolRegistry();
  const names = (text: string) => selectToolSchemas(reg, text).map((s) => s.name).sort();

  it("always advertises memory and gates the rest out of small talk", () => {
    expect(names("how's it going today?")).toEqual(["memory"]);
    expect(names("")).toEqual(["memory"]);
  });

  it("includes budget when the message is about spend or money", () => {
    expect(names("how much have I spent this month?")).toContain("budget");
    expect(names("set my monthly cap to $20")).toContain("budget");
    expect(names("what's my budget?")).toContain("budget");
  });

  it("includes models when the message is about models or pricing", () => {
    expect(names("add a new model and set its price")).toContain("models");
    expect(names("which llama model is the premium tier?")).toContain("models");
  });

  it("includes settings when the message is about settings", () => {
    expect(names("change my timezone")).toContain("settings");
    expect(names("update my digest hour")).toContain("settings");
  });

  it("matches case-insensitively", () => {
    expect(names("What's My BUDGET?")).toContain("budget");
  });
});
