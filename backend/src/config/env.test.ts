import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://aivo:aivo@localhost:5432/aivo",
  DISCORD_BOT_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_GUILD_ID: "guild",
  OWNER_DISCORD_USER_ID: "owner",
  DISCORD_HOME_CHANNEL_ID: "home",
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
});
