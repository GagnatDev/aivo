import { describe, expect, it } from "vitest";
import { isCommand, parseCommand, runCommand } from "./commands.js";
import type { IncomingMessage } from "./handleMessage.js";
import { makeAgentDeps, OWNER_ID } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

const incoming = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "msg-1",
  authorId: OWNER_ID,
  authorDisplayName: "Ann",
  channelId: "chan-1",
  content: "!help",
  ...over,
});

describe("parseCommand", () => {
  it("parses a bare command", () => {
    expect(parseCommand("!models")).toEqual({ name: "models", args: [] });
  });

  it("lowercases the command name", () => {
    expect(parseCommand("!MODELS")).toEqual({ name: "models", args: [] });
  });

  it("splits args on whitespace", () => {
    expect(parseCommand("!set_tier premium foo")).toEqual({
      name: "set_tier",
      args: ["premium", "foo"],
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCommand("   !models   ")).toEqual({ name: "models", args: [] });
  });

  it("returns null for a bare prefix", () => {
    expect(parseCommand("!")).toBeNull();
    expect(parseCommand("!   ")).toBeNull();
  });

  it("returns null for non-commands", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(isCommand("hello")).toBe(false);
    expect(isCommand("!models")).toBe(true);
  });
});

describe("runCommand", () => {
  it("!models lists the seeded models with prices and currency", async () => {
    const deps = makeAgentDeps();
    const reply = await runCommand(deps, incoming({ content: "!models" }));
    expect(reply).toContain("llama-3.1-8b-instruct");
    expect(reply).toContain("cheap");
    expect(reply).toContain("llama-3.3-70b-instruct");
    expect(reply).toContain("premium");
    expect(reply).toContain("EUR");
  });

  it("!budget reports spend against the ceiling for a provisioned user", async () => {
    const deps = makeAgentDeps();
    const reply = await runCommand(deps, incoming({ content: "!budget" }));
    expect(reply).toContain("Budget");
    expect(reply).toContain("Month to date");
  });

  it("!settings returns the user's default settings", async () => {
    const deps = makeAgentDeps();
    const reply = await runCommand(deps, incoming({ content: "!settings" }));
    expect(reply).toContain("Settings");
    expect(reply).toContain("Model tier");
  });

  it("!help lists all four commands", async () => {
    const deps = makeAgentDeps();
    const reply = await runCommand(deps, incoming({ content: "!help" }));
    expect(reply).toContain("!models");
    expect(reply).toContain("!budget");
    expect(reply).toContain("!settings");
    expect(reply).toContain("!help");
  });

  it("unknown commands point at !help", async () => {
    const deps = makeAgentDeps();
    const reply = await runCommand(deps, incoming({ content: "!bogus" }));
    expect(reply).toContain("Unknown command");
    expect(reply).toContain("!help");
  });

  it("JIT-provisions a brand-new author", async () => {
    const deps = makeAgentDeps();
    await runCommand(deps, incoming({ content: "!settings", authorId: "new-person" }));
    const user = await deps.users.findByDiscordId("new-person");
    expect(user).toBeDefined();
    expect(user?.is_owner).toBe(false);
  });
});
