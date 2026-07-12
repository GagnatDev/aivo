import { sql } from "kysely";
import type { Db } from "../db/kysely.js";

export interface UnforkedConnectionRow {
  id: number;
  api_key: string;
  owner_email: string | null;
  key_name: string | null;
  connected_by_user_id: string | null;
  verified_at: Date;
  created_at: Date;
}

const CONNECTION_COLUMNS = [
  "id",
  "api_key",
  "owner_email",
  "key_name",
  "connected_by_user_id",
  "verified_at",
  "created_at",
] as const;

/**
 * The singleton row for the one unforked (family meal planner) connection —
 * see migrations/020. The API key is registered from the dashboard's Settings
 * page and verified against unforked's /machine/v1/me before it lands here.
 */
export class UnforkedConnectionRepository {
  constructor(private readonly db: Db) {}

  /** Read the singleton — undefined means "not connected". */
  find(): Promise<UnforkedConnectionRow | undefined> {
    return this.db
      .selectFrom("unforked_connection")
      .select(CONNECTION_COLUMNS)
      .where("id", "=", 1)
      .executeTakeFirst();
  }

  /** The stored API key, or null when not connected (the client's key source). */
  async findApiKey(): Promise<string | null> {
    const row = await this.db
      .selectFrom("unforked_connection")
      .select("api_key")
      .where("id", "=", 1)
      .executeTakeFirst();
    return row?.api_key ?? null;
  }

  /** Register (or replace) the connection after the key verified successfully. */
  connect(input: {
    apiKey: string;
    ownerEmail: string | null;
    keyName: string | null;
    connectedByUserId: string | null;
  }): Promise<UnforkedConnectionRow> {
    return this.db
      .insertInto("unforked_connection")
      .values({
        id: 1,
        api_key: input.apiKey,
        owner_email: input.ownerEmail,
        key_name: input.keyName,
        connected_by_user_id: input.connectedByUserId,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          api_key: input.apiKey,
          owner_email: input.ownerEmail,
          key_name: input.keyName,
          connected_by_user_id: input.connectedByUserId,
          verified_at: sql`now()`,
          updated_at: sql`now()`,
        }),
      )
      .returning(CONNECTION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /** Drop the connection (and the stored key). Idempotent. */
  async disconnect(): Promise<void> {
    await this.db.deleteFrom("unforked_connection").where("id", "=", 1).execute();
  }
}
