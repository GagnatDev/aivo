import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect } from "kysely";
import { createPool } from "./pool.js";
import { MIGRATIONS_TABLE } from "./migrate.js";
import { renderSchema } from "./schemaRender.js";

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
    "messages.tool_calls":
      "ColumnType<StoredToolCall[] | null, string | null | undefined, string | null>",
    "model_pricing.capabilities": "ColumnType<ModelCapability[], string | undefined, string>",
    "model_tier_assignments.capability": "ModelCapability",
    "model_tier_assignments.tier_role": "ModelTierRole",
    "budget_config.degradation_state": "ColumnType<DegradationState, string | undefined, string>",
    "pending_approvals.status": "ColumnType<ApprovalStatus, string | undefined, string>",
    "budget_config.alert_thresholds": "ColumnType<number[], string | undefined, string>",
    "settings_permissions.member_editable_keys": "ColumnType<string[], string | undefined, string>",
    "settings.proactivity": "ColumnType<Record<string, unknown>, string | undefined, string>",
    "profiles.kind": "ProfileKind",
    "videos.transcript_status": "ColumnType<TranscriptStatus, string | undefined, string>",
    "videos.stage2_decision": "Stage2Decision | null",
    "digests.status": "ColumnType<DigestStatus, string | undefined, string>",
    "digests.failure_kind": "DigestFailureKind | null",
    "digest_items.kind": "DigestItemKind",
    "feedback.signal": "FeedbackSignal",
    "reminders.status": "ColumnType<ReminderStatus, string | undefined, string>",
    "turn_summaries.outcome": "TurnOutcome",
    "turn_summaries.tools_called": "ColumnType<string[], string, string>",
    "turn_summaries.finish_reasons": "ColumnType<StoredFinishReason[], string, string>",
  },
} as const;

// Wire the override type names to their hand-authored source so the generated file
// imports them (ColumnType comes from kysely and is always imported by the renderer when used).
const CUSTOM_IMPORTS = {
  Channel: "./schema.enums.js",
  MessageRole: "./schema.enums.js",
  StoredToolCall: "./schema.enums.js",
  ModelTierRole: "./schema.enums.js",
  ModelCapability: "./schema.enums.js",
  DegradationState: "./schema.enums.js",
  ApprovalStatus: "./schema.enums.js",
  ProfileKind: "./schema.enums.js",
  TranscriptStatus: "./schema.enums.js",
  Stage2Decision: "./schema.enums.js",
  DigestStatus: "./schema.enums.js",
  DigestFailureKind: "./schema.enums.js",
  DigestItemKind: "./schema.enums.js",
  FeedbackSignal: "./schema.enums.js",
  ReminderStatus: "./schema.enums.js",
  TurnOutcome: "./schema.enums.js",
  StoredFinishReason: "./schema.enums.js",
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
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: createPool(connectionString) }),
  });
  let source: string;
  try {
    const tables = await db.introspection.getTables();
    source = renderSchema(
      // Skip node-pg-migrate's bookkeeping table — it's created by runMigrations, not
      // part of the app schema, and never queried through Kysely.
      tables.filter((t) => t.schema === "public" && t.name !== MIGRATIONS_TABLE),
      { overrides: OVERRIDES.columns, customImports: CUSTOM_IMPORTS },
    );
  } finally {
    await db.destroy();
  }

  if (!verify) {
    await writeFile(SCHEMA_OUT_FILE, source);
    return;
  }
  const committed = await readFile(SCHEMA_OUT_FILE, "utf8").catch(() => "");
  if (committed !== source) {
    throw new Error("src/db/schema.ts is out of date with the migrations.");
  }
}
