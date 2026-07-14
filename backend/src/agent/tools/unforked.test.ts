import { describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { systemClock } from "../clock.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { useCleanDb } from "../../test/db.js";
import { makeFakeLlm } from "../../test/fakeLlm.js";
import { makeFakeUnforked, type FakeUnforkedOptions } from "../../test/fakeUnforked.js";
import type { UnforkedClient } from "../../unforked/client.js";

useCleanDb();

const registry = buildToolRegistry();
const tool = (): AgentTool => {
  const t = registry.find((x) => x.schema.name === "unforked");
  if (!t) throw new Error("no unforked tool");
  return t;
};

async function ctxFor(unforked: UnforkedClient | null): Promise<ToolContext> {
  const deps = makeAgentDeps(makeFakeLlm([]), {}, systemClock, unforked);
  const { userId, isOwner, conversationId } = await provisionUser(deps, OWNER_ID);
  return { deps, userId, isOwner, conversationId };
}

const ctxWith = (options: FakeUnforkedOptions = {}) => ctxFor(makeFakeUnforked(options));

const MEAL_PLAN = {
  weekIdentifier: "2026-W29",
  defaultPersons: 4,
  assignments: [
    {
      day: "MONDAY",
      persons: 4,
      recipe: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Kikertsalat",
        tags: ["vegetar"],
      },
    },
  ],
};

describe("unforked tool", () => {
  it("reports not configured when UNFORKED_BASE_URL is unset", async () => {
    const ctx = await ctxFor(null);
    const out = await tool().execute({ action: "meal_plan" }, ctx);
    expect(out).toContain("isn't configured");
  });

  it("points at dashboard registration (not chat) when no key is registered", async () => {
    const ctx = await ctxWith({ notConnected: true });
    const out = await tool().execute({ action: "meal_plan" }, ctx);
    expect(out).toContain("dashboard Settings page");
    expect(out).toContain("not via chat");
  });

  it("returns the meal plan and defaults the week to current", async () => {
    const fake = makeFakeUnforked({ mealPlan: MEAL_PLAN });
    const ctx = await ctxFor(fake);
    const out = await tool().execute({ action: "meal_plan" }, ctx);
    expect(JSON.parse(out)).toEqual(MEAL_PLAN);
    expect(fake.calls).toEqual([{ method: "getMealPlan", arg: "current" }]);
  });

  it("passes the week through (aliases and literals) and validates its shape", async () => {
    const fake = makeFakeUnforked();
    const ctx = await ctxFor(fake);
    await tool().execute({ action: "shopping_list", week: "next" }, ctx);
    await tool().execute({ action: "meal_plan", week: "2026-W52" }, ctx);
    expect(fake.calls.map((c) => c.arg)).toEqual(["next", "2026-W52"]);

    const bad = await tool().execute({ action: "meal_plan", week: "tomorrow" }, ctx);
    expect(bad).toContain("week must be");
    expect(fake.calls).toHaveLength(2); // the invalid week never reached the client
  });

  it("summarizes an empty plan/list in plain words", async () => {
    const ctx = await ctxWith();
    expect(await tool().execute({ action: "meal_plan" }, ctx)).toContain("No meals are planned");
    expect(await tool().execute({ action: "shopping_list" }, ctx)).toContain("is empty");
    expect(await tool().execute({ action: "recipes" }, ctx)).toContain("no recipes");
  });

  it("returns the shopping list without internal ids", async () => {
    const ctx = await ctxWith({
      shoppingList: {
        weekIdentifier: "2026-W29",
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Melk",
            quantity: "1",
            unit: "l",
            recipeIds: [],
            category: "dairy",
            checked: true,
            manual: true,
          },
        ],
      },
    });
    const out = JSON.parse(await tool().execute({ action: "shopping_list" }, ctx));
    expect(out.items).toEqual([
      { name: "Melk", quantity: "1", unit: "l", category: "dairy", checked: true },
    ]);
  });

  it("fetches a full recipe by id and requires the id", async () => {
    const recipe = {
      id: "33333333-3333-4333-8333-333333333333",
      doc: {
        name: "Pannekaker",
        description: "",
        ingredients: [{ name: "mel", quantity: "3", unit: "dl" }],
        steps: ["Visp.", "Stek."],
        servings: 4,
        tags: [],
      },
    };
    const ctx = await ctxWith({ recipe });
    expect(await tool().execute({ action: "recipe" }, ctx)).toContain("Provide 'recipe_id'");
    const out = JSON.parse(await tool().execute({ action: "recipe", recipe_id: recipe.id }, ctx));
    expect(out.doc.name).toBe("Pannekaker");
  });

  describe("add_shopping_items", () => {
    it("adds items to the current week by default and confirms what was added", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      const out = await tool().execute(
        {
          action: "add_shopping_items",
          items: [{ name: "melk", quantity: "1", unit: "l" }, { name: "batterier" }],
        },
        ctx,
      );
      expect(out).toBe("Added to the 2026-W29 shopping list: melk (1 l), batterier.");
      expect(fake.calls).toEqual([{ method: "addShoppingListItems", arg: "current" }]);
      expect(fake.addedItems).toEqual([
        { name: "melk", quantity: "1", unit: "l" },
        { name: "batterier" },
      ]);
    });

    it("coerces items sent as a JSON-encoded string (a common open-model slip)", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      const out = await tool().execute(
        {
          action: "add_shopping_items",
          items: '[{"name": "melk", "quantity": "2", "unit": "l"}, {"name": "dopapir"}]',
        },
        ctx,
      );
      expect(out).toBe("Added to the 2026-W29 shopping list: melk (2 l), dopapir.");
      expect(fake.addedItems).toEqual([
        { name: "melk", quantity: "2", unit: "l" },
        { name: "dopapir" },
      ]);
    });

    it("lifts bare-string entries to { name }", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      const out = await tool().execute(
        { action: "add_shopping_items", items: ["melk", "dopapir"] },
        ctx,
      );
      expect(out).toBe("Added to the 2026-W29 shopping list: melk, dopapir.");
    });

    it("still rejects a non-JSON string with the normal error", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      const out = await tool().execute(
        { action: "add_shopping_items", items: "melk og dopapir" },
        ctx,
      );
      expect(out).toContain("Invalid arguments");
      expect(fake.calls).toHaveLength(0);
    });

    it("adds to next week's list when asked", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      await tool().execute(
        { action: "add_shopping_items", week: "next", items: [{ name: "melk" }] },
        ctx,
      );
      expect(fake.calls).toEqual([{ method: "addShoppingListItems", arg: "next" }]);
    });

    it("requires items and rejects an empty list", async () => {
      const fake = makeFakeUnforked();
      const ctx = await ctxFor(fake);
      const missing = await tool().execute({ action: "add_shopping_items" }, ctx);
      expect(missing).toContain("Provide 'items'");
      const empty = await tool().execute({ action: "add_shopping_items", items: [] }, ctx);
      expect(empty).toContain("items must not be empty");
      expect(fake.calls).toHaveLength(0);
    });

    it("refuses non-owners without calling unforked", async () => {
      const fake = makeFakeUnforked();
      const deps = makeAgentDeps(makeFakeLlm([]), {}, systemClock, fake);
      const { userId, isOwner, conversationId } = await provisionUser(deps, "someone-else");
      const out = await tool().execute(
        { action: "add_shopping_items", items: [{ name: "melk" }] },
        { deps, userId, isOwner, conversationId },
      );
      expect(out).toBe("Refused: only the owner can do that.");
      expect(fake.calls).toHaveLength(0);
    });

    it("explains a read-only key when unforked answers 403", async () => {
      const ctx = await ctxWith({ failStatus: 403 });
      const out = await tool().execute(
        { action: "add_shopping_items", items: [{ name: "melk" }] },
        ctx,
      );
      expect(out).toContain("read-only");
      expect(out).toContain("write access");
      expect(out).toContain("Settings page");
    });
  });

  it("explains a rejected (revoked) key and points at the dashboard", async () => {
    const ctx = await ctxWith({ failStatus: 401 });
    const out = await tool().execute({ action: "recipes" }, ctx);
    expect(out).toContain("rejected the API key");
    expect(out).toContain("Settings page");
  });

  it("degrades gracefully when unforked is unreachable", async () => {
    const ctx = await ctxWith({ unreachable: true });
    const out = await tool().execute({ action: "meal_plan" }, ctx);
    expect(out).toContain("Could not reach unforked");
  });
});
