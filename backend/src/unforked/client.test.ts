import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnforkedClient, UnforkedApiError, UnforkedTimeoutError } from "./client.js";

const base = "http://unforked-machine.homectl";
const client = (timeoutMs?: number) =>
  createUnforkedClient({ baseUrl: base, getApiKey: async () => "ufk_test", timeoutMs });

/** A fetch stub that resolves with a JSON body and records how it was called. */
function okFetch(body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("createUnforkedClient — request shape", () => {
  it("GETs reads with the bearer token and a timeout signal, no body", async () => {
    const fetchMock = okFetch({ weekIdentifier: "2026-W29", items: [] });
    vi.stubGlobal("fetch", fetchMock);

    await client().getShoppingList("current");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/machine/v1/shopping-lists/current`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ufk_test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("POSTs writes with a JSON body and a timeout signal", async () => {
    const fetchMock = okFetch({ weekIdentifier: "2026-W29", items: [] });
    vi.stubGlobal("fetch", fetchMock);

    await client().addShoppingListItems("next", [{ name: "vannmelon" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/machine/v1/shopping-lists/next/items`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ items: [{ name: "vannmelon" }] });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("createUnforkedClient — timeout", () => {
  // A fetch that never resolves on its own and only settles when the request's abort
  // signal fires — exactly how the real fetch behaves under AbortSignal.timeout.
  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const reason = (init.signal as AbortSignal).reason;
            reject(reason ?? new DOMException("aborted", "AbortError"));
          });
        }),
    );
  }

  it("aborts a hung write and throws UnforkedTimeoutError instead of hanging", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    await expect(
      client(20).addShoppingListItems("current", [{ name: "vannmelon" }]),
    ).rejects.toBeInstanceOf(UnforkedTimeoutError);
  });

  it("aborts a hung read too", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(client(20).getShoppingList("current")).rejects.toBeInstanceOf(
      UnforkedTimeoutError,
    );
  });

  it("does not mask a genuine non-abort fetch error as a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed"); // e.g. connection refused / DNS
      }),
    );
    const err = await client(20)
      .getShoppingList("current")
      .catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(UnforkedTimeoutError);
  });

  it("surfaces a non-2xx response as UnforkedApiError, not a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "This API key does not have the 'write' scope" }),
      })),
    );
    const err = await client()
      .addShoppingListItems("current", [{ name: "melk" }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnforkedApiError);
    expect((err as UnforkedApiError).status).toBe(403);
  });
});
