import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";

const app = buildApp();

describe("GET /health", () => {
  it("returns a 200 liveness response", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
