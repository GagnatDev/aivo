import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, getDialect } from "kysely-codegen";

// Single source of truth for how `db/schema.ts` is generated. Both the
// regenerate script (scripts/codegen.ts) and the drift-check test
// (db/schema.codegen.test.ts) call runSchemaCodegen so they can never disagree
// about dialect, overrides, or output location. See docs/architecture-improvements.md §1.10.

/** The committed, generated schema file — written on regenerate, verified in the test. */
export const SCHEMA_OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.ts");

// Columns whose true TypeScript shape can't be inferred from the SQL type alone.
// `TEXT` columns that hold a fixed set of values map to the hand-authored unions in
// schema.enums.ts; JSONB columns map to the concrete shapes the repositories read/write
// (Postgres stores JSON but node-pg returns it parsed, and we write it as a JSON string).
const OVERRIDES = {
  columns: {
    "conversations.channel": "Channel",
    "messages.role": "MessageRole",
    "model_pricing.tier_role": "ModelTierRole | null",
    "budget_config.degradation_state": "ColumnType<DegradationState, string | undefined, string>",
    "pending_approvals.status": "ColumnType<ApprovalStatus, string | undefined, string>",
    "budget_config.alert_thresholds": "ColumnType<number[], string | undefined, string>",
    "settings_permissions.member_editable_keys": "ColumnType<string[], string | undefined, string>",
    "settings.proactivity": "ColumnType<Record<string, unknown>, string | undefined, string>",
  },
} as const;

// Wire the override type names to their hand-authored source so the generated file
// imports them (ColumnType comes from kysely and is already imported by the generator).
const CUSTOM_IMPORTS = {
  Channel: "./schema.enums.js",
  MessageRole: "./schema.enums.js",
  ModelTierRole: "./schema.enums.js",
  DegradationState: "./schema.enums.js",
  ApprovalStatus: "./schema.enums.js",
} as const;

/**
 * Introspect `connectionString` and (re)generate `db/schema.ts`, or — with
 * `{ verify: true }` — throw if the committed file is out of date instead of
 * rewriting it. The caller owns the database lifecycle (a migrated Testcontainers
 * Postgres in both call sites).
 */
export async function runSchemaCodegen(
  connectionString: string,
  { verify = false }: { verify?: boolean } = {},
): Promise<void> {
  // node-pg returns `numeric` as a string to preserve precision (the money convention,
  // see docs/data-model.md); keep the generated read type a string to match.
  const dialect = getDialect("postgres", { numericParser: "string" });
  const db = await dialect.introspector.connect({ connectionString, dialect });
  try {
    await generate({
      db,
      dialect,
      outFile: SCHEMA_OUT_FILE,
      overrides: OVERRIDES,
      customImports: CUSTOM_IMPORTS,
      typeOnlyImports: true,
      verify,
    });
  } finally {
    await db.destroy();
  }
}
