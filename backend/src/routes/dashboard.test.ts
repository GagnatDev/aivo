import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevAuthProvider } from "../auth/devProvider.js";
import { UserRepository } from "../storage/userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

function buildDashboardApp(webRoot?: string) {
  const users = new UserRepository(testDb());
  const options: Parameters<typeof buildApp>[0] = {
    auth: {
      provider: createDevAuthProvider(),
      callbackPath: "/auth/callback",
      dashboard: { users },
    },
  };
  if (webRoot) options.webRoot = webRoot;
  return { app: buildApp(options), users };
}

async function provisionOwner(users: UserRepository) {
  return users.upsertByDiscordId({
    discordUserId: "discord-owner",
    displayName: "Ann-Katrin",
    isOwner: true,
  });
}

describe("GET /api/dashboard/me", () => {
  it("returns the resolved owner for an authenticated request", async () => {
    const { app, users } = buildDashboardApp();
    const owner = await provisionOwner(users);
    const res = await request(app).get("/api/dashboard/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: owner.id, displayName: "Ann-Katrin", isOwner: true },
    });
  });

  it("403s non-owner principals (owner-only v1)", async () => {
    const { app, users } = buildDashboardApp();
    await provisionOwner(users);
    const res = await request(app).get("/api/dashboard/me").set("x-dev-role", "member");
    expect(res.status).toBe(403);
  });
});

describe("SPA static serving", () => {
  it("serves index.html for client-routed paths but not API/auth paths", async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), "aivo-web-"));
    writeFileSync(path.join(webRoot, "index.html"), "<html><body>aivo shell</body></html>");
    const { app, users } = buildDashboardApp(webRoot);
    await provisionOwner(users);

    const shell = await request(app).get("/");
    expect(shell.status).toBe(200);
    expect(shell.text).toContain("aivo shell");

    // Client-side route falls back to the shell on a hard reload.
    const clientRoute = await request(app).get("/usage");
    expect(clientRoute.status).toBe(200);
    expect(clientRoute.text).toContain("aivo shell");

    // API namespace is never shadowed by the SPA fallback.
    const api = await request(app).get("/api/dashboard/nope");
    expect(api.status).toBe(404);
    expect(api.text).not.toContain("aivo shell");
  });

  it("keeps /health JSON when a webRoot is configured", async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), "aivo-web-"));
    writeFileSync(path.join(webRoot, "index.html"), "<html></html>");
    const { app } = buildDashboardApp(webRoot);
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
