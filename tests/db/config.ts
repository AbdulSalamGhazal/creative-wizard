/**
 * Shared connection + identity constants for the real-database test harness.
 * DB tests run against a dedicated `ccms_test` database on the local docker
 * Postgres — NEVER `ccms` (dev data) and NEVER prod.
 *
 * `CCMS_TEST_DB` gives a session its own copy (`ccms_test_a01`), so parallel
 * worktree sessions don't re-seed each other's database mid-run. The pattern
 * is the guard: it can only ever name a `ccms_test*` database.
 */
const PG_HOST = "postgres://ccms:ccms_dev_password@localhost:5432";

const TEST_DB_PATTERN = /^ccms_test(_[a-z0-9]+)?$/;
const requested = process.env.CCMS_TEST_DB ?? "ccms_test";
if (!TEST_DB_PATTERN.test(requested)) {
  throw new Error(`CCMS_TEST_DB must match ${TEST_DB_PATTERN} — got "${requested}"`);
}
export const TEST_DB = requested;
export const TEST_DATABASE_URL = `${PG_HOST}/${TEST_DB}`;
/** A maintenance connection (existing `ccms` db) used only to CREATE the test db. */
export const MAINTENANCE_URL = `${PG_HOST}/ccms`;

/** Two fixed accounts so tenancy isolation is testable. */
export const ACCOUNT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const ACCOUNT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
