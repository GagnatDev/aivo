import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSidecarAuthProvider } from "./sidecarProvider.js";

function appWithEcho() {
  const app = express();
  const provider = createSidecarAuthProvider();
  app.get("/whoami", provider.authMiddleware, (req, res) => {
    res.json(req.user);
  });
  return app;
}

describe("createSidecarAuthProvider", () => {
  it("reads the identity the sidecar injects via X-Homectl-* headers", async () => {
    const res = await request(appWithEcho())
      .get("/whoami")
      .set("X-Homectl-User", "auth-sub-1")
      .set("X-Homectl-Email", "owner@example.com")
      .set("X-Homectl-Role", "owner");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "auth-sub-1",
      email: "owner@example.com",
      role: "owner",
    });
  });

  it("maps an absent role header to null (no role in this app)", async () => {
    const res = await request(appWithEcho())
      .get("/whoami")
      .set("X-Homectl-User", "auth-sub-1")
      .set("X-Homectl-Email", "user@example.com");
    expect(res.body.role).toBeNull();
  });

  it("401s when the sidecar injected no user (request never authenticated)", async () => {
    const res = await request(appWithEcho()).get("/whoami");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });
});
