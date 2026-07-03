import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDevAuthProvider } from "../auth/devProvider.js";
import { UserRepository } from "../storage/userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";
import { resolveUser } from "./resolveUser.js";

useCleanDb();

function buildApp() {
  const users = new UserRepository(testDb());
  const provider = createDevAuthProvider();
  const app = express();
  app.get("/probe", provider.authMiddleware, resolveUser(users), (req, res) => {
    res.json({ userId: req.userId, isOwner: req.appUser?.is_owner });
  });
  return { app, users };
}

async function provisionOwner(users: UserRepository) {
  return users.upsertByDiscordId({
    discordUserId: "discord-owner",
    displayName: "Ann-Katrin",
    isOwner: true,
  });
}

describe("resolveUser", () => {
  it("links the owner row on first login and resolves it on the next", async () => {
    const { app, users } = buildApp();
    const owner = await provisionOwner(users);

    const first = await request(app).get("/probe");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ userId: owner.id, isOwner: true });

    // The seam is now filled; the second request resolves by auth_sub.
    const linked = await users.findByAuthSub("dev-owner");
    expect(linked?.id).toBe(owner.id);
    const second = await request(app).get("/probe");
    expect(second.body.userId).toBe(owner.id);
  });

  it("403s when no owner row has been provisioned yet", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/probe");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("403s a principal without the owner role (owner-only v1 gate)", async () => {
    const { app, users } = buildApp();
    await provisionOwner(users);
    const res = await request(app).get("/probe").set("x-dev-role", "member");
    expect(res.status).toBe(403);
  });

  it("403s a second subject once the owner row is claimed", async () => {
    const { app, users } = buildApp();
    await provisionOwner(users);
    await request(app).get("/probe");
    const res = await request(app).get("/probe").set("x-dev-sub", "intruder-sub");
    expect(res.status).toBe(403);
    // The original link is untouched.
    expect((await users.findByAuthSub("dev-owner"))?.is_owner).toBe(true);
    expect(await users.findByAuthSub("intruder-sub")).toBeUndefined();
  });

  it("403s an already-linked non-owner row (household members wait for PRD §7.1)", async () => {
    const { app, users } = buildApp();
    await provisionOwner(users);
    const member = await users.upsertByDiscordId({
      discordUserId: "discord-member",
      displayName: "Member",
      isOwner: false,
    });
    await testDb()
      .updateTable("users")
      .set({ auth_sub: "member-sub" })
      .where("id", "=", member.id)
      .execute();

    const res = await request(app).get("/probe").set("x-dev-sub", "member-sub");
    expect(res.status).toBe(403);
  });
});
