import { describe, expect, it } from "vitest";
import { UserRepository } from "./userRepository.js";
import { testDb } from "../test/db.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

describe("UserRepository.upsertByDiscordId", () => {
  it("provisions a new user on first sight", async () => {
    const users = new UserRepository(testDb());
    const row = await users.upsertByDiscordId({
      discordUserId: "111",
      displayName: "Ann",
      isOwner: true,
    });
    expect(row.discord_user_id).toBe("111");
    expect(row.is_owner).toBe(true);
    expect(row.auth_sub).toBeNull();
    expect(await users.count()).toBe(1);
  });

  it("is idempotent — a second message touches, not duplicates", async () => {
    const users = new UserRepository(testDb());
    const first = await users.upsertByDiscordId({
      discordUserId: "222",
      displayName: "Old Name",
      isOwner: false,
    });
    const second = await users.upsertByDiscordId({
      discordUserId: "222",
      displayName: "New Name",
      isOwner: false,
    });
    expect(second.id).toBe(first.id);
    expect(second.display_name).toBe("New Name");
    expect(await users.count()).toBe(1);
  });

  it("finds a user by discord id", async () => {
    const users = new UserRepository(testDb());
    await users.upsertByDiscordId({
      discordUserId: "333",
      displayName: null,
      isOwner: false,
    });
    const found = await users.findByDiscordId("333");
    expect(found?.discord_user_id).toBe("333");
    expect(await users.findByDiscordId("nope")).toBeUndefined();
  });
});

describe("UserRepository auth_sub linking (dashboard, phase 3)", () => {
  it("linkOwnerAuthSub claims the owner row once and findByAuthSub resolves it", async () => {
    const users = new UserRepository(testDb());
    const owner = await users.upsertByDiscordId({
      discordUserId: "444",
      displayName: "Owner",
      isOwner: true,
    });

    const linked = await users.linkOwnerAuthSub("sub-1");
    expect(linked?.id).toBe(owner.id);
    expect(linked?.auth_sub).toBe("sub-1");
    expect((await users.findByAuthSub("sub-1"))?.id).toBe(owner.id);

    // Single-shot: a second subject cannot steal or overwrite the link.
    expect(await users.linkOwnerAuthSub("sub-2")).toBeUndefined();
    expect((await users.findByAuthSub("sub-1"))?.id).toBe(owner.id);
    expect(await users.findByAuthSub("sub-2")).toBeUndefined();
  });

  it("linkOwnerAuthSub returns undefined when no owner row exists", async () => {
    const users = new UserRepository(testDb());
    await users.upsertByDiscordId({ discordUserId: "555", displayName: null, isOwner: false });
    expect(await users.linkOwnerAuthSub("sub-1")).toBeUndefined();
  });
});
