import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://aivo:aivo@localhost:5432/aivo",
  DISCORD_BOT_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_GUILD_ID: "guild",
  OWNER_DISCORD_USER_ID: "owner",
  DISCORD_HOME_CHANNEL_ID: "home",
  LLM_API_KEY: "llm-key",
  LLM_BASE_URL: "https://api.scaleway.ai/v1",
};

describe("loadEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadEnv(validEnv as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DISCORD_BOT_TOKEN).toBe("token");
  });

  it("coerces PORT to a number", () => {
    const env = loadEnv({ ...validEnv, PORT: "9090" } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(9090);
  });

  it("throws when DISCORD_BOT_TOKEN is missing", () => {
    const { DISCORD_BOT_TOKEN, ...missing } = validEnv;
    void DISCORD_BOT_TOKEN;
    expect(() => loadEnv(missing as NodeJS.ProcessEnv)).toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    const { DATABASE_URL, ...missing } = validEnv;
    void DATABASE_URL;
    expect(() => loadEnv(missing as NodeJS.ProcessEnv)).toThrow();
  });

  it("accepts DISCORD_HOME_CHANNEL_ID when present", () => {
    const env = loadEnv({ ...validEnv, DISCORD_HOME_CHANNEL_ID: "123456" } as NodeJS.ProcessEnv);
    expect(env.DISCORD_HOME_CHANNEL_ID).toBe("123456");
  });

  it("throws when DISCORD_HOME_CHANNEL_ID is missing", () => {
    const { DISCORD_HOME_CHANNEL_ID, ...missing } = validEnv;
    void DISCORD_HOME_CHANNEL_ID;
    expect(() => loadEnv(missing as NodeJS.ProcessEnv)).toThrow();
  });

  it("defaults OFFLINE_ACK_THRESHOLD_MINUTES to 15 and coerces it", () => {
    expect(loadEnv(validEnv as NodeJS.ProcessEnv).OFFLINE_ACK_THRESHOLD_MINUTES).toBe(15);
    const env = loadEnv({ ...validEnv, OFFLINE_ACK_THRESHOLD_MINUTES: "30" } as NodeJS.ProcessEnv);
    expect(env.OFFLINE_ACK_THRESHOLD_MINUTES).toBe(30);
  });

  it("throws when LLM_API_KEY is missing", () => {
    const { LLM_API_KEY, ...missing } = validEnv;
    void LLM_API_KEY;
    expect(() => loadEnv(missing as NodeJS.ProcessEnv)).toThrow();
  });

  it("throws when LLM_BASE_URL is not a URL", () => {
    expect(() =>
      loadEnv({ ...validEnv, LLM_BASE_URL: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("applies LLM/agent defaults", () => {
    const env = loadEnv(validEnv as NodeJS.ProcessEnv);
    expect(env.LLM_MAX_OUTPUT_TOKENS).toBe(1024);
    expect(env.AGENT_MAX_TOOL_ITERATIONS).toBe(5);
    expect(env.AGENT_CONTEXT_MESSAGE_LIMIT).toBe(15);
    expect(env.AGENT_MEMORY_INJECT_LIMIT).toBe(20);
    expect(env.APPROVAL_TTL_MINUTES).toBe(60);
  });
});
