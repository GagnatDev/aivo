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
