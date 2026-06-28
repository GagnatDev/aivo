import { Pool } from "pg";
import { env } from "../config/env.js";

/** Create a pg connection pool. Sizing mirrors the small single-replica deployment. */
export function createPool(connectionString: string = env.DATABASE_URL): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
