import { describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { makeFakeLlm } from "../../test/fakeLlm.js";
import { useCleanDb } from "../../test/db.js";

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
