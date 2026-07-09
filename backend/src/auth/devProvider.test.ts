import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDevAuthProvider, DEV_AUTH_SUB } from "./devProvider.js";

function appWithEcho() {
  const app = express();
  const provider = createDevAuthProvider();
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
  });
});
