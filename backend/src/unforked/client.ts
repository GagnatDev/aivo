// HTTP client for unforked's machine API (unforked docs/aivo-integration.md §5):
// the family meal planner's in-cluster, API-key-authenticated read surface at
// UNFORKED_BASE_URL (the ingress-less `unforked-machine` Service). The network
// impl lives behind the UnforkedClient interface so the agent tool and the
// dashboard route are testable against a fake (test/fakeUnforked.ts).

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

export interface UnforkedClient {
  /** Self-check an explicit key — the dashboard registration path. */
  verifyKey(apiKey: string): Promise<UnforkedMe>;
  /** week = "current" | "next" | "YYYY-Wnn" (aliases resolve server-side). */
  getMealPlan(week: string): Promise<UnforkedMealPlan>;
  getShoppingList(week: string): Promise<UnforkedShoppingList>;
  getCompactRecipes(): Promise<UnforkedCompactRecipe[]>;
  getRecipe(id: string): Promise<UnforkedRecipe>;
}

export interface UnforkedClientConfig {
  /** e.g. http://unforked-machine.homectl (in-cluster service DNS). */
  baseUrl: string;
  /** The registered key, read per call so a dashboard (re-)registration applies immediately. */
  getApiKey: () => Promise<string | null>;
}

export function createUnforkedClient(config: UnforkedClientConfig): UnforkedClient {
  const base = config.baseUrl.replace(/\/+$/, "");

  async function get<T>(path: string, apiKey: string): Promise<T> {
    const res = await fetch(`${base}/machine/v1${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) {
      let message = `unforked responded ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Non-JSON error body — keep the status message.
      }
      throw new UnforkedApiError(res.status, message);
    }
    return (await res.json()) as T;
  }

  async function authed<T>(path: string): Promise<T> {
    const apiKey = await config.getApiKey();
    if (!apiKey) throw new UnforkedNotConnectedError();
    return get<T>(path, apiKey);
  }

  return {
    verifyKey: (apiKey) => get<UnforkedMe>("/me", apiKey),
    getMealPlan: (week) => authed(`/meal-plans/${encodeURIComponent(week)}`),
    getShoppingList: (week) => authed(`/shopping-lists/${encodeURIComponent(week)}`),
    getCompactRecipes: () => authed("/recipes/compact"),
    getRecipe: (id) => authed(`/recipes/${encodeURIComponent(id)}`),
  };
}
