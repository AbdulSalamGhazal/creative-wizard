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
//
// `max: 1` has a sharp edge: a `db.transaction(...)` callback HOLDS the only
// connection, so any query it runs through the global `db` (instead of its
// `tx`) waits for a connection that can never come back — the request hangs
// until the function is killed. Locally (`max: 10`) that never shows, which is
// why `DB_POOL_MAX` exists: the DB test suite sets it to 1 so it runs at the
// PRODUCTION pool size and such a query fails the suite (2026-10, reactions
// hung in prod this way). Never query `db` inside a `db.transaction` callback.
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DB_POOL_MAX?.trim() ?? "";
  if (/^[1-9][0-9]*$/.test(raw)) return Number(raw);
  return env.NODE_ENV === "production" ? 1 : 10;
}

const globalForPg = globalThis as unknown as {
  __ccmsPg?: ReturnType<typeof postgres>;
};
const client =
  globalForPg.__ccmsPg ??
  postgres(connectionString, {
    prepare: false,
    max: poolMax(),
    idle_timeout: 20,
    // Fail a stuck connection fast instead of letting the request hang until the
    // serverless function times out. 10s still comfortably covers a normal Neon
    // cold-wake from scale-to-zero; a real outage surfaces the error boundary
    // (and a logged error) in seconds rather than ~25s+.
    connect_timeout: 10,
  });
globalForPg.__ccmsPg = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
