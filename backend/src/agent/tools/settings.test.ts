import { describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
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
