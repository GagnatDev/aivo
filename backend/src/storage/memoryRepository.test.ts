import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memoryRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const memories = new MemoryRepository(db);
  const users = new UserRepository(db);
  const user = await users.upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  const other = await users.upsertByDiscordId({
    discordUserId: "u2",
    displayName: null,
    isOwner: false,
  });
  return { memories, userId: user.id, otherId: other.id };
}

describe("MemoryRepository", () => {
  it("inserts and lists active memories newest first", async () => {
    const { memories, userId } = await setup();
    await memories.insert({ userId, content: "likes coffee", category: "preference" });
    await memories.insert({ userId, content: "lives in Oslo", category: "fact" });
    const active = await memories.listActive(userId);
    expect(active.map((m) => m.content)).toEqual(["lives in Oslo", "likes coffee"]);
  });

  it("forget soft-deletes and drops the memory from the active set", async () => {
    const { memories, userId } = await setup();
    const m = await memories.insert({ userId, content: "temporary note" });
    const forgotten = await memories.forget(m.id, userId);
    expect(forgotten?.forgotten_at).toBeInstanceOf(Date);
    expect(await memories.listActive(userId)).toHaveLength(0);
  });

  it("does not let a user forget another user's memory", async () => {
    const { memories, userId, otherId } = await setup();
    const m = await memories.insert({ userId, content: "owner secret" });
    expect(await memories.forget(m.id, otherId)).toBeUndefined();
    expect(await memories.listActive(userId)).toHaveLength(1);
  });

  it("listForgotten returns only soft-deleted rows, newest forgotten first", async () => {
    const { memories, userId } = await setup();
    await memories.insert({ userId, content: "keep me" });
    const gone = await memories.insert({ userId, content: "drop me" });
    await memories.forget(gone.id, userId);
    const forgotten = await memories.listForgotten(userId);
    expect(forgotten.map((m) => m.content)).toEqual(["drop me"]);
    expect(forgotten[0]?.forgotten_at).toBeInstanceOf(Date);
  });

  it("search matches case-insensitively on content, active only", async () => {
    const { memories, userId } = await setup();
    await memories.insert({ userId, content: "Prefers dark roast COFFEE" });
    const gone = await memories.insert({ userId, content: "old coffee fact" });
    await memories.forget(gone.id, userId);
    const hits = await memories.search(userId, "coffee");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toBe("Prefers dark roast COFFEE");
  });

  it("treats LIKE wildcards in the search term literally", async () => {
    const { memories, userId } = await setup();
    await memories.insert({ userId, content: "100% sure about this" });
    await memories.insert({ userId, content: "1000 widgets ordered" });
    // Unescaped, '%' would wildcard-match "1000 widgets" too; escaped it matches only the literal "100%".
    const hits = await memories.search(userId, "100%");
    expect(hits.map((m) => m.content)).toEqual(["100% sure about this"]);
  });
});
