import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDevAuthProvider, DEV_AUTH_SUB } from "./devProvider.js";

function appWithEcho() {
  const app = express();
  const provider = createDevAuthProvider();
  app.get("/auth/login", provider.loginHandler);
  app.get("/whoami", provider.authMiddleware, (req, res) => {
    res.json(req.user);
  });
  return app;
}

describe("createDevAuthProvider", () => {
  it("authenticates every request as the fixed owner principal", async () => {
    const res = await request(appWithEcho()).get("/whoami");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: DEV_AUTH_SUB,
      email: `${DEV_AUTH_SUB}@dev.local`,
      isAdmin: true,
      role: "owner",
    });
  });

  it("lets tests impersonate another subject via x-dev-sub", async () => {
    const res = await request(appWithEcho()).get("/whoami").set("x-dev-sub", "someone-else");
    expect(res.body.id).toBe("someone-else");
  });

  it("lets tests drop the owner role via x-dev-role", async () => {
    const res = await request(appWithEcho()).get("/whoami").set("x-dev-role", "member");
    expect(res.body.role).toBe("member");
    expect(res.body.isAdmin).toBe(false);
  });

  it("bounces /auth/login straight back to a safe relative path", async () => {
    const app = appWithEcho();
    const ok = await request(app).get("/auth/login?next=/usage");
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe("/usage");
    const evil = await request(app).get("/auth/login?next=https://evil.example");
    expect(evil.headers.location).toBe("/");
  });
});
