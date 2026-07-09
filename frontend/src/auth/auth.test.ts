import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "./auth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth (auth-agnostic SPA behind the sidecar)", () => {
  it("fetch delegates to a plain same-origin fetch, adding no auth headers", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", spy);
    const init = { headers: { Accept: "application/json" } };
    await auth.fetch("/api/dashboard/me", init);
    expect(spy).toHaveBeenCalledWith("/api/dashboard/me", init);
  });

  it("login bounces to a full page load at the app root", () => {
    const location = { href: "" };
    vi.stubGlobal("window", { location });
    auth.login();
    // A top-level navigation lets the sidecar 302 an unauthenticated request to login.
    expect(location.href).toBe("/");
  });

  it("logout navigates to the sidecar logout path", () => {
    const location = { href: "" };
    vi.stubGlobal("window", { location });
    auth.logout();
    expect(location.href).toBe("/auth/logout");
  });
});
