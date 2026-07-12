import {
  UnforkedApiError,
  UnforkedNotConnectedError,
  type UnforkedClient,
  type UnforkedCompactRecipe,
  type UnforkedMe,
  type UnforkedMealPlan,
  type UnforkedRecipe,
  type UnforkedShoppingList,
} from "../unforked/client.js";

export const FAKE_ME: UnforkedMe = {
  email: "ann.katrin@example.com",
  familyId: "fam-1",
  key: {
    id: "key-1",
    name: "Aivo",
    scopes: ["read"],
    createdAt: "2026-07-01T00:00:00.000Z",
    expiresAt: null,
  },
};

export interface FakeUnforkedOptions {
  mealPlan?: UnforkedMealPlan;
  shoppingList?: UnforkedShoppingList;
  recipes?: UnforkedCompactRecipe[];
  recipe?: UnforkedRecipe;
  me?: UnforkedMe;
  /** Data calls throw UnforkedNotConnectedError (no key registered). */
  notConnected?: boolean;
  /** All calls throw this status (e.g. 401 for a revoked key). */
  failStatus?: number;
  /** All calls throw a network-level error (unforked unreachable). */
  unreachable?: boolean;
}

export interface FakeUnforked extends UnforkedClient {
  /** Call log: method + argument, in order. */
  calls: { method: string; arg?: string }[];
}

/** An in-memory UnforkedClient for tool/route tests — no network, no key handling. */
export function makeFakeUnforked(options: FakeUnforkedOptions = {}): FakeUnforked {
  const calls: { method: string; arg?: string }[] = [];

  function guard(method: string, arg?: string): void {
    calls.push({ method, arg });
    if (options.unreachable) throw new Error("fetch failed");
    if (options.failStatus) throw new UnforkedApiError(options.failStatus, "fake failure");
    if (options.notConnected && method !== "verifyKey") throw new UnforkedNotConnectedError();
  }

  return {
    calls,
    async verifyKey(apiKey) {
      guard("verifyKey", apiKey);
      return options.me ?? FAKE_ME;
    },
    async getMealPlan(week) {
      guard("getMealPlan", week);
      return (
        options.mealPlan ?? { weekIdentifier: "2026-W29", defaultPersons: null, assignments: [] }
      );
    },
    async getShoppingList(week) {
      guard("getShoppingList", week);
      return options.shoppingList ?? { weekIdentifier: "2026-W29", items: [] };
    },
    async getCompactRecipes() {
      guard("getCompactRecipes");
      return options.recipes ?? [];
    },
    async getRecipe(id) {
      guard("getRecipe", id);
      if (options.recipe) return options.recipe;
      throw new UnforkedApiError(404, "Recipe not found");
    },
  };
}
