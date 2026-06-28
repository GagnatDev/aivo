import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import type { Database } from "./schema.js";

/** Build a typed Kysely instance over an existing pg pool. */
export function createDb(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export type Db = Kysely<Database>;
