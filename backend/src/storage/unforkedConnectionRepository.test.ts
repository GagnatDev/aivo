import { describe, expect, it } from "vitest";
import { testDb, useCleanDb } from "../test/db.js";
import { UserRepository } from "./userRepository.js";
import { UnforkedConnectionRepository } from "./unforkedConnectionRepository.js";

useCleanDb();

const repo = () => new UnforkedConnectionRepository(testDb());

async function owner() {
  return new UserRepository(testDb()).upsertByDiscordId({
    discordUserId: "discord-owner",
    displayName: "Ann-Katrin",
    isOwner: true,
  });
}

describe("UnforkedConnectionRepository", () => {
  it("finds nothing before a connection is registered", async () => {
    expect(await repo().find()).toBeUndefined();
    expect(await repo().findApiKey()).toBeNull();
  });

  it("connect stores the key + metadata and find reads it back", async () => {
    const user = await owner();
    const row = await repo().connect({
      apiKey: "ufk_secret",
      ownerEmail: "ann@example.com",
      keyName: "Aivo",
      connectedByUserId: user.id,
    });
    expect(row.id).toBe(1);
    expect(row.owner_email).toBe("ann@example.com");
    expect(await repo().findApiKey()).toBe("ufk_secret");
  });

  it("connect replaces an existing connection (singleton upsert)", async () => {
    const user = await owner();
    await repo().connect({
      apiKey: "ufk_old",
      ownerEmail: "ann@example.com",
      keyName: "old",
      connectedByUserId: user.id,
    });
    const replaced = await repo().connect({
      apiKey: "ufk_new",
      ownerEmail: "ann@example.com",
      keyName: "new",
      connectedByUserId: user.id,
    });
    expect(replaced.key_name).toBe("new");
    expect(await repo().findApiKey()).toBe("ufk_new");
    expect(await repo().find()).toMatchObject({ id: 1, api_key: "ufk_new" });
  });

  it("disconnect drops the row and is idempotent", async () => {
    const user = await owner();
    await repo().connect({
      apiKey: "ufk_secret",
      ownerEmail: null,
      keyName: null,
      connectedByUserId: user.id,
    });
    await repo().disconnect();
    await repo().disconnect();
    expect(await repo().find()).toBeUndefined();
  });

  it("survives the connecting user being deleted (ON DELETE SET NULL)", async () => {
    const user = await owner();
    await repo().connect({
      apiKey: "ufk_secret",
      ownerEmail: null,
      keyName: null,
      connectedByUserId: user.id,
    });
    await testDb().deleteFrom("users").where("id", "=", user.id).execute();
    const row = await repo().find();
    expect(row?.api_key).toBe("ufk_secret");
    expect(row?.connected_by_user_id).toBeNull();
  });
});
