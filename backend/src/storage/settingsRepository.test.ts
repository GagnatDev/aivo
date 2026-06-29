import { describe, expect, it } from "vitest";
import { SettingsRepository } from "./settingsRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const settings = new SettingsRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { settings, userId: user.id };
}

describe("SettingsRepository", () => {
  it("getOrCreate provisions defaults and is idempotent", async () => {
    const { settings, userId } = await setup();
    const first = await settings.getOrCreate(userId);
    expect(first.model_tier).toBe("auto");
    expect(first.timezone).toBe("Europe/Oslo");
    expect(first.persona_prompt).toBeNull();
    const second = await settings.getOrCreate(userId);
    expect(second.user_id).toBe(first.user_id);
  });

  it("update applies a partial patch", async () => {
    const { settings, userId } = await setup();
    const updated = await settings.update(userId, {
      model_tier: "cheap",
      persona_prompt: "be more casual",
    });
    expect(updated.model_tier).toBe("cheap");
    expect(updated.persona_prompt).toBe("be more casual");
    // Untouched fields keep their defaults.
    expect(updated.digest_hour).toBe(7);
  });
});
