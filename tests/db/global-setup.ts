import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { MAINTENANCE_URL, TEST_DATABASE_URL, TEST_DB } from "./config";

/**
 * vitest globalSetup for the DB suite: provision `ccms_test` (create it if
 * missing) and bring its schema up to date by running the Drizzle migrations.
 * Idempotent — migrations track themselves, so re-runs are no-ops. Each test
 * file re-seeds via `resetAndSeed()`, so the database persists between runs.
 */
export default async function setup() {
  const admin = postgres(MAINTENANCE_URL, { max: 1 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (exists.length === 0) {
      // `unsafe` — CREATE DATABASE can't be parameterized or run in a tx.
      await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }
}
