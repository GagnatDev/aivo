import cookieParser from "cookie-parser";
import express from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuthClient, type AuthClientResult } from "./vendoredHomectlAuthClient.js";

const AUTH_SERVICE_URL = "https://auth.homectl.test";
const CLIENT_ID = "aivo";
const APP_BASE_URL = "https://aivo.homectl.test";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let client: AuthClientResult;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  client = createAuthClient({
    authServiceUrl: AUTH_SERVICE_URL,
    clientId: CLIENT_ID,
    clientSecret: "test-secret",
    appBaseUrl: APP_BASE_URL,
    _jwksProvider: createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] }),
  });
});

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.get("/auth/login", client.loginHandler);
  app.get("/whoami", client.authMiddleware, (req, res) => {
    res.json(req.user);
  });
  return app;
}

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    email: "owner@example.com",
    isAdmin: false,
    apps: [{ appId: CLIENT_ID, role: "owner" }],
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("auth-sub-1")
    .setIssuer(AUTH_SERVICE_URL)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
}

describe("vendored homectl-auth client", () => {
  it("verifies a valid RS256 token and extracts the app role", async () => {
    const token = await signToken();
    const res = await request(buildApp()).get("/whoami").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "auth-sub-1",
      email: "owner@example.com",
      isAdmin: false,
      role: "owner",
    });
  });

  it("maps a token without an aivo apps[] entry to role null", async () => {
    const token = await signToken({ apps: [{ appId: "other-app", role: "admin" }] });
    const res = await request(buildApp()).get("/whoami").set("Authorization", `Bearer ${token}`);
    expect(res.body.role).toBeNull();
  });

  it("401s JSON requests without a token", async () => {
    const res = await request(buildApp()).get("/whoami").set("Accept", "application/json");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("401s a token with the wrong audience", async () => {
    const token = await signToken({});
    const wrongAudience = await new SignJWT({ email: "x@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("auth-sub-1")
      .setIssuer(AUTH_SERVICE_URL)
      .setAudience("some-other-app")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey);
    void token;
    const res = await request(buildApp())
      .get("/whoami")
      .set("Authorization", `Bearer ${wrongAudience}`)
      .set("Accept", "application/json");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_token" });
  });

  it("redirects HTML requests without a token to the auth service", async () => {
    const res = await request(buildApp()).get("/whoami").set("Accept", "text/html");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin).toBe(AUTH_SERVICE_URL);
    expect(location.pathname).toBe("/authorize");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP_BASE_URL}/auth/callback`);
    expect(location.searchParams.get("state")).toBeTruthy();
    // The signed state cookie rides along for the callback round-trip.
    expect(res.headers["set-cookie"]?.[0]).toContain("homectl_auth_state=");
  });

  it("starts the flow from /auth/login and rejects absolute next URLs", async () => {
    const res = await request(buildApp()).get("/auth/login?next=https://evil.example");
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location!).pathname).toBe("/authorize");
    const state = res.headers["set-cookie"]?.[0]?.split(";")[0]?.split("=")[1];
    const decoded = JSON.parse(
      Buffer.from(decodeURIComponent(state!).split(".")[0]!, "base64").toString("utf-8"),
    );
    expect(decoded.originalUrl).toBe("/");
  });
});
