import { describe, expect, inject, it } from "vitest";
import { runSchemaCodegen } from "./codegen.js";

// Guards §1.10: db/schema.ts is generated from the migrations, never hand-edited.
// This reuses the migrated Testcontainers Postgres from global-setup (no extra
// container) and regenerates in `verify` mode, which throws if the committed file
// disagrees with what the current migrations would produce. A drifted column type
// (the failure §1.10 targets) fails here instead of shipping confidently-wrong types.
describe("db/schema.ts codegen", () => {
  it("matches what the migrations generate (run `pnpm db:codegen` if this fails)", async () => {
    await expect(
      runSchemaCodegen(inject("databaseUrl"), { verify: true }),
    ).resolves.toBeUndefined();
  });
});
