import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://aivo:aivo@localhost:5432/aivo",
  DISCORD_BOT_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_GUILD_ID: "guild",
  OWNER_DISCORD_USER_ID: "owner",
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
});
