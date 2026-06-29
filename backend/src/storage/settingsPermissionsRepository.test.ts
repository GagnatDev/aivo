import { describe, expect, it } from "vitest";
import { SettingsPermissionsRepository } from "./settingsPermissionsRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

describe("SettingsPermissionsRepository", () => {
  it("starts from the seeded allow-list", async () => {
    const repo = new SettingsPermissionsRepository(testDb());
    const { memberEditableKeys } = await repo.get();
    expect(memberEditableKeys).toEqual(["persona_prompt"]);
  });

  it("setKeys replaces the allow-list", async () => {
    const repo = new SettingsPermissionsRepository(testDb());
    const updated = await repo.setKeys(["persona_prompt", "timezone"]);
    expect(updated).toEqual(["persona_prompt", "timezone"]);
    expect((await repo.get()).memberEditableKeys).toEqual(["persona_prompt", "timezone"]);
    // Restore the seed so other tests see the default (this table isn't truncated).
    await repo.setKeys(["persona_prompt"]);
  });
});
