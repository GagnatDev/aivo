import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import type { DB } from "./schema.js";

/** Build a typed Kysely instance over an existing pg pool. */
export function createDb(pool: Pool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export type Db = Kysely<DB>;
