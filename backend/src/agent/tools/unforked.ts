import { z } from "zod";
import {
  UnforkedApiError,
  UnforkedNotConnectedError,
  type UnforkedClient,
} from "../../unforked/client.js";
import { OWNER_ONLY, parse, type AgentTool } from "./index.js";

/**
 * Access to unforked, the family's meal planner (unforked
 * docs/aivo-integration.md): meal plan and shopping list by week, the compact
 * recipe corpus for "what can I make with X?" matching (the model does the
 * ingredient matching itself — synonyms and near-matches are what it's good
 * at), full recipes by id, and one write: adding items to a week's shopping
 * list ("add milk and batteries"), which is owner-only and needs a key with
 * unforked's `write` scope. The API key is registered on the dashboard's
 * Settings page, never over chat.
 */

const NOT_CONFIGURED =
  "The unforked meal planner isn't configured on this deployment (UNFORKED_BASE_URL is unset).";
const NOT_CONNECTED =
  "Unforked isn't connected yet: no API key is registered. The owner can create a key in " +
  "unforked (API keys page) and register it on Aivo's dashboard Settings page — not via chat.";

const WEEK_PATTERN = /^(current|next|\d{4}-W\d{2})$/;

const unforkedArgs = z.object({
  action: z.enum(["meal_plan", "shopping_list", "add_shopping_items", "recipes", "recipe"]),
  week: z.string().regex(WEEK_PATTERN, "week must be 'current', 'next' or 'YYYY-Wnn'").optional(),
  recipe_id: z.string().uuid("recipe_id must be a recipe uuid from an earlier result").optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "each item needs a name"),
        quantity: z.string().optional(),
        unit: z.string().optional(),
      }),
    )
    .min(1, "items must not be empty")
    .max(50, "at most 50 items at a time")
    .optional(),
});

export const unforkedTool: AgentTool = {
  // Bilingual gate (see selectToolSchemas in index.js): the owner asks about food in
  // Norwegian — middag/ukemeny/handleliste/oppskrift and friends must trip it, or the
  // capability is silently dead for those turns.
  gate: /\b(meal\w*|dinner|supper|lunch\w*|cook\w*|recipe\w*|grocer\w*|shopping\s?list\w*|ingredient\w*|fridge|middag\w*|kveldsmat\w*|lunsj\w*|meny\w*|ukemeny\w*|ukesmeny\w*|matplan\w*|mat|matrett\w*|oppskrift\w*|handleliste\w*|handlelista|ingrediens\w*|kjøleskap\w*|spis\w*)\b/i,
  schema: {
    name: "unforked",
    description:
      "The family's unforked meal planner. Actions: 'meal_plan' (week's dinner plan, " +
      "answers 'what's for dinner?'); 'shopping_list' (week's list incl. what's already " +
      "checked off); 'add_shopping_items' (add one or more items to a week's shopping list — " +
      "owner only); 'recipes' (compact corpus of ALL family recipes with ingredient names — " +
      "use it to suggest what to cook from ingredients on hand, matching synonyms yourself); " +
      "'recipe' (full recipe by recipe_id, with steps and quantities). week is 'current' " +
      "(default), 'next', or ISO 'YYYY-Wnn' — never compute week numbers yourself. " +
      "Apart from adding shopping-list items, everything is read-only: you cannot change " +
      "the plan, check items off, or remove items.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["meal_plan", "shopping_list", "add_shopping_items", "recipes", "recipe"],
        },
        week: {
          type: "string",
          description:
            "'current' (default), 'next', or 'YYYY-Wnn' " +
            "(action=meal_plan/shopping_list/add_shopping_items)",
        },
        recipe_id: { type: "string", description: "recipe uuid (action=recipe)" },
        items: {
          type: "array",
          description:
            "items to add (action=add_shopping_items); quantity/unit are free-form " +
            "strings like '2' and 'l' and may be omitted",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "string" },
              unit: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(unforkedArgs, args);
    if (!p.ok) return p.error;
    const a = p.value;

    const client: UnforkedClient | null = ctx.deps.unforked;
    if (!client) return NOT_CONFIGURED;

    try {
      switch (a.action) {
        case "meal_plan": {
          const plan = await client.getMealPlan(a.week ?? "current");
          if (plan.assignments.length === 0) {
            return `No meals are planned for ${plan.weekIdentifier}.`;
          }
          return JSON.stringify(plan);
        }
        case "shopping_list": {
          const list = await client.getShoppingList(a.week ?? "current");
          if (list.items.length === 0) {
            return `The shopping list for ${list.weekIdentifier} is empty.`;
          }
          return JSON.stringify({
            weekIdentifier: list.weekIdentifier,
            items: list.items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
              category: i.category,
              checked: i.checked,
            })),
          });
        }
        case "add_shopping_items": {
          if (!ctx.isOwner) return OWNER_ONLY;
          if (!a.items) return "Provide 'items' (the items to add, each with at least a name).";
          const added = await client.addShoppingListItems(a.week ?? "current", a.items);
          const names = added.items.map((i) => {
            const amount = [i.quantity, i.unit].filter(Boolean).join(" ");
            return amount ? `${i.name} (${amount})` : i.name;
          });
          return `Added to the ${added.weekIdentifier} shopping list: ${names.join(", ")}.`;
        }
        case "recipes": {
          const recipes = await client.getCompactRecipes();
          if (recipes.length === 0) return "The family has no recipes in unforked yet.";
          return JSON.stringify(recipes);
        }
        case "recipe": {
          if (!a.recipe_id) return "Provide 'recipe_id' (a uuid from meal_plan or recipes).";
          const recipe = await client.getRecipe(a.recipe_id);
          return JSON.stringify(recipe);
        }
      }
    } catch (err) {
      if (err instanceof UnforkedNotConnectedError) return NOT_CONNECTED;
      if (err instanceof UnforkedApiError) {
        if (err.status === 401) {
          return (
            "Unforked rejected the API key (it may have been revoked). The owner can " +
            "register a fresh key on the dashboard's Settings page."
          );
        }
        if (err.status === 403) {
          return (
            "Unforked refused the write: the registered API key is read-only. The owner can " +
            "create a new key in unforked with write access ('Allow changes') and register " +
            "it on the dashboard's Settings page."
          );
        }
        if (err.status === 404) return "Not found in unforked (wrong recipe_id?).";
        return `Unforked request failed: ${err.message}`;
      }
      return "Could not reach unforked — it may be down; try again later.";
    }
  },
};
