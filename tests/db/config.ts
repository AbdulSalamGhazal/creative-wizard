/**
 * Shared connection + identity constants for the real-database test harness.
 * DB tests run against a dedicated `ccms_test` database on the local docker
 * Postgres — NEVER `ccms` (dev data) and NEVER prod.
 */
const PG_HOST = "postgres://ccms:ccms_dev_password@localhost:5432";

export const TEST_DB = "ccms_test";
export const TEST_DATABASE_URL = `${PG_HOST}/${TEST_DB}`;
/** A maintenance connection (existing `ccms` db) used only to CREATE the test db. */
export const MAINTENANCE_URL = `${PG_HOST}/ccms`;

/** Two fixed accounts so tenancy isolation is testable. */
export const ACCOUNT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const ACCOUNT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
