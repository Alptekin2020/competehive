import { Pool } from "pg";

const globalForPool = globalThis as unknown as {
  pgPool: Pool | undefined;
};

export const pool =
  globalForPool.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pool;

export default pool;
