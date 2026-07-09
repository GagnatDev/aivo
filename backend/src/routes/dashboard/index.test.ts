import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSidecarAuthProvider } from "../../auth/sidecarProvider.js";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/me", () => {
  it("returns the resolved owner for an authenticated request", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: owner.id, displayName: "Ann-Katrin", isOwner: true },
    });
  });

  it("403s non-owner principals (owner-only v1)", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/me").set("x-dev-role", "member");
    expect(res.status).toBe(403);
  });
});

// End-to-end through the real sidecar provider: the injected X-Homectl-* headers
// flow through buildApp → authMiddleware → resolveUser to the owner row, exactly
// as they would behind the homectl-auth-proxy in prod.
describe("GET /api/dashboard/me (sidecar auth)", () => {
  const sidecarApp = () => buildDashboardTestApp({ provider: createSidecarAuthProvider() });

  it("resolves the owner from the sidecar's identity headers", async () => {
    const { app, deps } = sidecarApp();
    const owner = await provisionTestOwner(deps);
    const res = await request(app)
      .get("/api/dashboard/me")
      .set("X-Homectl-User", "auth-sub-1")
      .set("X-Homectl-Email", "owner@example.com")
      .set("X-Homectl-Role", "owner");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(owner.id);
  });

  it("401s when the sidecar injected no identity (no session)", async () => {
    const { app, deps } = sidecarApp();
    await provisionTestOwner(deps);
    const res = await request(app).get("/api/dashboard/me");
    expect(res.status).toBe(401);
  });

  it("403s a non-owner-role principal (owner-only v1 gate)", async () => {
    const { app, deps } = sidecarApp();
    await provisionTestOwner(deps);
    const res = await request(app)
      .get("/api/dashboard/me")
      .set("X-Homectl-User", "member-sub")
      .set("X-Homectl-Email", "member@example.com")
      .set("X-Homectl-Role", "member");
    expect(res.status).toBe(403);
  });
});

describe("SPA static serving", () => {
  it("serves index.html for client-routed paths but not API/auth paths", async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), "aivo-web-"));
    writeFileSync(path.join(webRoot, "index.html"), "<html><body>aivo shell</body></html>");
    const { app, deps } = buildDashboardTestApp({ webRoot });
    await provisionTestOwner(deps);

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
    const { app } = buildDashboardTestApp({ webRoot });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
