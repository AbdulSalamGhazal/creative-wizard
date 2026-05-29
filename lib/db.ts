import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// One client per process, cached on globalThis so it survives both dev HMR and
// warm serverless invocations (otherwise every Lambda/route instance would open
// its own pool and exhaust Postgres connections).
//
// In production the app must point at a *pooled* connection string (e.g. Neon's
// `-pooler` host); we keep `max: 1` per instance so the serverless fleet fans
// in through that pooler instead of each instance holding many connections.
const globalForPg = globalThis as unknown as {
  __ccmsPg?: ReturnType<typeof postgres>;
};
const client =
  globalForPg.__ccmsPg ??
  postgres(connectionString, {
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 1 : 10,
    idle_timeout: 20,
  });
globalForPg.__ccmsPg = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
