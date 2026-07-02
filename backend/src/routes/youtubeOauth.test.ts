import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const OAUTH = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUrl: "https://aivo.example/youtube/oauth/callback",
};

describe("youtube oauth routes", () => {
  it("are absent when the OAuth client is not configured", async () => {
    await request(buildApp()).get("/youtube/oauth/start").expect(404);
  });

  it("start redirects to Google's consent screen with offline access", async () => {
    const res = await request(buildApp({ youtubeOauth: OAUTH })).get("/youtube/oauth/start");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH.redirectUrl);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("youtube.readonly");
  });

  it("callback demands a code", async () => {
    const res = await request(buildApp({ youtubeOauth: OAUTH })).get("/youtube/oauth/callback");
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing \?code/);
  });
});
