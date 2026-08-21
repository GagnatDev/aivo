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

  it("logout submits a top-level POST to the sidecar logout path", () => {
    // The sidecar handles logout on POST only (a GET 404s at the app), so logout
    // drives a top-level POST navigation via a hidden form and lets the browser
    // follow the sidecar's 302 home.
    const submit = vi.fn();
    const form: Record<string, unknown> = { submit };
    const createElement = vi.fn(() => form);
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement, body: { appendChild } });

    auth.logout();

    expect(createElement).toHaveBeenCalledWith("form");
    expect(form.method).toBe("post");
    expect(form.action).toBe("/auth/logout");
    expect(appendChild).toHaveBeenCalledWith(form);
    expect(submit).toHaveBeenCalledOnce();
  });
});
