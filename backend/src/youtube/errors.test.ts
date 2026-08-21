import { describe, expect, it } from "vitest";
import { tokenRefreshError, YoutubeApiError } from "./errors.js";

describe("tokenRefreshError", () => {
  it("classifies the expired/revoked refresh token as auth (the #83 failure)", () => {
    const err = tokenRefreshError(
      400,
      '{\n  "error": "invalid_grant",\n  "error_description": "Token has been expired or revoked."\n}',
    );
    expect(err).toBeInstanceOf(YoutubeApiError);
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(400);
    expect(err.message).toBe(
      "YouTube OAuth token refresh failed (400 invalid_grant: Token has been expired or revoked.)",
    );
  });

  it("classifies a misconfigured OAuth client as auth too", () => {
    expect(tokenRefreshError(401, '{"error":"invalid_client"}').kind).toBe("auth");
    expect(tokenRefreshError(400, '{"error":"unauthorized_client"}').kind).toBe("auth");
  });

  it("treats a token-endpoint outage as a transient api failure", () => {
    const err = tokenRefreshError(503, '{"error":"backendError","error_description":"try again"}');
    expect(err.kind).toBe("api");
    expect(err.message).toContain("backendError: try again");
  });

  it("keeps a non-JSON body as the detail, bounded", () => {
    const err = tokenRefreshError(502, `<html>${"x".repeat(500)}</html>`);
    expect(err.kind).toBe("api");
    expect(err.message.length).toBeLessThan(260);
  });
});
