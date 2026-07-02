import { Pool } from "pg";

/** Create a pg connection pool. Sizing mirrors the small single-replica deployment. */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
