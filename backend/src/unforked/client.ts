// HTTP client for unforked's machine API (unforked docs/aivo-integration.md §5):
// the family meal planner's in-cluster, API-key-authenticated surface at
// UNFORKED_BASE_URL (the ingress-less `unforked-machine` Service). Reads work
// with any key; the one write (adding shopping-list items) needs a key carrying
// the `write` scope. The network impl lives behind the UnforkedClient interface
// so the agent tool and the dashboard route are testable against a fake
// (test/fakeUnforked.ts).

/** Response of GET /machine/v1/me — the credential self-check. */
export interface UnforkedMe {
  email: string;
  familyId: string;
  key: {
    id: string;
    name: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
  };
}

export interface UnforkedMealPlan {
  weekIdentifier: string;
  defaultPersons: number | null;
  assignments: {
    day: string;
    persons: number | null;
    recipe: { id: string; name: string; tags: string[] };
  }[];
}

export interface UnforkedShoppingListItem {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  recipeIds: string[];
  category: string;
  checked: boolean;
  manual: boolean;
}

export interface UnforkedShoppingList {
  weekIdentifier: string;
  items: UnforkedShoppingListItem[];
}

/** An item to add to a week's list. quantity/unit are free-form ("2", "dl"). */
export interface UnforkedNewShoppingListItem {
  name: string;
  quantity?: string;
  unit?: string;
}

/** Response of the add call: the created entries only, not the whole list. */
export interface UnforkedAddedShoppingListItems {
  weekIdentifier: string;
  items: UnforkedShoppingListItem[];
}

/** Token-efficient corpus shape for LLM-side ingredient matching (§5.3 option B). */
export interface UnforkedCompactRecipe {
  id: string;
  name: string;
  tags: string[];
  ingredients: string[];
}

export interface UnforkedRecipe {
  id: string;
  doc: {
    name: string;
    description: string;
    ingredients: { name: string; quantity: string; unit: string }[];
    steps: string[];
    servings: number;
    tags: string[];
  };
}

/** A non-2xx response from unforked (401 = key rejected, 400 = bad week, …). */
export class UnforkedApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UnforkedApiError";
  }
}

/** Thrown by data calls when no API key has been registered in the dashboard yet. */
export class UnforkedNotConnectedError extends Error {
  constructor() {
    super("No unforked API key is registered");
    this.name = "UnforkedNotConnectedError";
  }
}

/**
 * Thrown when a request to unforked exceeds the configured timeout. Without a
 * timeout a slow or wedged machine API (e.g. a shopping-list write blocked on a
 * row lock during a deploy) leaves the fetch hanging on undici's multi-minute
 * default — long enough that the agent turn dies with no tool result and the
 * model, seeing nothing come back, confabulates an explanation to the owner. A
 * bounded timeout turns that silent hang into a prompt, honest failure the tool
 * can report.
 */
export class UnforkedTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`unforked did not respond within ${timeoutMs}ms`);
    this.name = "UnforkedTimeoutError";
  }
}

export interface UnforkedClient {
  /** Self-check an explicit key — the dashboard registration path. */
  verifyKey(apiKey: string): Promise<UnforkedMe>;
  /** week = "current" | "next" | "YYYY-Wnn" (aliases resolve server-side). */
  getMealPlan(week: string): Promise<UnforkedMealPlan>;
  getShoppingList(week: string): Promise<UnforkedShoppingList>;
  getCompactRecipes(): Promise<UnforkedCompactRecipe[]>;
  getRecipe(id: string): Promise<UnforkedRecipe>;
  /** Add manual items to a week's list. Requires a key with the `write` scope (403 otherwise). */
  addShoppingListItems(
    week: string,
    items: UnforkedNewShoppingListItem[],
  ): Promise<UnforkedAddedShoppingListItems>;
}

/** Default per-request timeout. Well under the agent's turn budget and Discord's
 * interaction window, so a wedged unforked fails fast instead of hanging the turn. */
export const DEFAULT_UNFORKED_TIMEOUT_MS = 10_000;

export interface UnforkedClientConfig {
  /** e.g. http://unforked-machine.homectl (in-cluster service DNS). */
  baseUrl: string;
  /** The registered key, read per call so a dashboard (re-)registration applies immediately. */
  getApiKey: () => Promise<string | null>;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_UNFORKED_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export function createUnforkedClient(config: UnforkedClientConfig): UnforkedClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_UNFORKED_TIMEOUT_MS;

  async function call<T>(path: string, apiKey: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      // Every call is time-bounded (AbortSignal.timeout): a machine API that never
      // answers — a write wedged on a row lock, a pod restarting mid-deploy — must not
      // hang the fetch on undici's ~5-minute default and take the whole turn down with it.
      res = await fetch(`${base}/machine/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      // AbortSignal.timeout fires a "TimeoutError"; a caller-driven abort is "AbortError".
      // Either way the request is over its budget — surface it as a timeout the tool can
      // report, rather than the opaque DOMException. Other fetch errors (DNS, connection
      // refused) fall through to the tool's "could not reach unforked" branch.
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new UnforkedTimeoutError(timeoutMs);
      }
      throw err;
    }
    if (!res.ok) {
      let message = `unforked responded ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) message = errBody.error;
      } catch {
        // Non-JSON error body — keep the status message.
      }
      throw new UnforkedApiError(res.status, message);
    }
    return (await res.json()) as T;
  }

  async function authed<T>(path: string, body?: unknown): Promise<T> {
    const apiKey = await config.getApiKey();
    if (!apiKey) throw new UnforkedNotConnectedError();
    return call<T>(path, apiKey, body);
  }

  return {
    verifyKey: (apiKey) => call<UnforkedMe>("/me", apiKey),
    getMealPlan: (week) => authed(`/meal-plans/${encodeURIComponent(week)}`),
    getShoppingList: (week) => authed(`/shopping-lists/${encodeURIComponent(week)}`),
    getCompactRecipes: () => authed("/recipes/compact"),
    getRecipe: (id) => authed(`/recipes/${encodeURIComponent(id)}`),
    addShoppingListItems: (week, items) =>
      authed(`/shopping-lists/${encodeURIComponent(week)}/items`, { items }),
  };
}
