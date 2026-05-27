import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// One pooled client per process. In Next.js dev with HMR, cache on globalThis
// so each module reload reuses the same pool instead of leaking connections.
const globalForPg = globalThis as unknown as { __ccmsPg?: ReturnType<typeof postgres> };
const client = globalForPg.__ccmsPg ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") globalForPg.__ccmsPg = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
