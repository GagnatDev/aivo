import { describe, expect, it } from "vitest";
import { ProfileRepository } from "./profileRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const profiles = new ProfileRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  return { profiles, userId: user.id };
}

describe("ProfileRepository", () => {
  it("returns undefined when no profile was ever written", async () => {
    const { profiles, userId } = await setup();
    expect(await profiles.getCurrent(userId, "youtube_interest")).toBeUndefined();
  });

  it("setCurrent versions updates and keeps exactly one current row", async () => {
    const { profiles, userId } = await setup();
    const v1 = await profiles.setCurrent(userId, "youtube_interest", "likes woodworking");
    expect(v1.version).toBe(1);
    const v2 = await profiles.setCurrent(
      userId,
      "youtube_interest",
      "likes woodworking, no shorts",
    );
    expect(v2.version).toBe(2);
    const current = await profiles.getCurrent(userId, "youtube_interest");
    expect(current?.id).toBe(v2.id);
    expect(current?.body).toMatch(/no shorts/);
  });

  it("kinds are independent", async () => {
    const { profiles, userId } = await setup();
    await profiles.setCurrent(userId, "youtube_interest", "videos");
    expect(await profiles.getCurrent(userId, "mail_importance")).toBeUndefined();
  });
});
