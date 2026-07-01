import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const g = globalThis as unknown as { _pool?: Pool };

function getPool() {
  if (!g._pool) {
    g._pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return g._pool;
}

export const db = drizzle(getPool(), { schema });
