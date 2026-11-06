import type { ColumnMetadata, TableMetadata } from "kysely";
import { describe, expect, it } from "vitest";
import { renderSchema } from "./schemaRender.js";

const column = (name: string, dataType: string, extra: Partial<ColumnMetadata> = {}) => ({
  name,
  dataType,
  isNullable: false,
  hasDefaultValue: false,
  isAutoIncrementing: false,
  ...extra,
});

const table = (name: string, columns: ColumnMetadata[]): TableMetadata => ({
  name,
  schema: "public",
  isView: false,
  isForeign: false,
  columns,
});

const NO_OPTIONS = { overrides: {}, customImports: {} };

// The end-to-end guarantee (committed schema.ts == what the migrations produce) lives in
// schema.codegen.test.ts; these pin the renderer's type rules without a database.
describe("renderSchema", () => {
  it("maps scalars and wraps nullable / defaulted columns", () => {
    const out = renderSchema(
      [
        table("llm_usage", [
          column("tokens_in", "int4"),
          column("model", "text", { isNullable: true }),
          column("id", "uuid", { hasDefaultValue: true }),
          column("cost_cents", "numeric", { isNullable: true, hasDefaultValue: true }),
          column("created_at", "timestamptz"),
        ]),
      ],
      NO_OPTIONS,
    );

    expect(out).toContain(`export interface LlmUsage {
  cost_cents: Generated<Numeric | null>;
  created_at: Timestamp;
  id: Generated<string>;
  model: string | null;
  tokens_in: number;
}`);
    expect(out).toContain("export type Generated<T>");
    expect(out).toContain("export type Numeric =");
    expect(out).toContain('import type { ColumnType } from "kysely";');
    expect(out).toContain("export interface DB {\n  llm_usage: LlmUsage;\n}");
  });

  it("emits helper aliases only when a column uses them", () => {
    const out = renderSchema([table("users", [column("name", "text")])], NO_OPTIONS);

    expect(out).not.toContain("Generated");
    expect(out).not.toContain("Timestamp");
    expect(out).not.toContain("import");
  });

  it("uses overrides verbatim and imports only the custom types they reference", () => {
    const out = renderSchema(
      [
        table("messages", [
          column("role", "text"),
          column("tool_calls", "jsonb", { isNullable: true, hasDefaultValue: true }),
        ]),
      ],
      {
        overrides: {
          "messages.role": "MessageRole",
          "messages.tool_calls":
            "ColumnType<StoredToolCall[] | null, string | null, string | null>",
        },
        customImports: {
          StoredToolCall: "./schema.enums.js",
          MessageRole: "./schema.enums.js",
          Unused: "./schema.enums.js",
        },
      },
    );

    expect(out).toContain("  role: MessageRole;");
    expect(out).toContain(
      "  tool_calls: ColumnType<StoredToolCall[] | null, string | null, string | null>;",
    );
    expect(out).toContain(
      'import type { MessageRole, StoredToolCall } from "./schema.enums.js";\nimport type { ColumnType } from "kysely";',
    );
  });

  it("sorts interfaces by type name and columns by name", () => {
    const out = renderSchema(
      [
        table("youtube_account", [column("b", "text"), column("a", "text")]),
        table("budget_config", [column("x", "bool")]),
      ],
      NO_OPTIONS,
    );

    expect(out.indexOf("interface BudgetConfig")).toBeLessThan(
      out.indexOf("interface YoutubeAccount"),
    );
    expect(out).toContain("export interface YoutubeAccount {\n  a: string;\n  b: string;\n}");
  });

  it("fails loudly on a Postgres type with no mapping", () => {
    expect(() => renderSchema([table("videos", [column("raw", "bytea")])], NO_OPTIONS)).toThrow(
      /videos\.raw \(Postgres type "bytea"\)/,
    );
  });
});
