import { beforeAll, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Trends → Launches (W1-12, audit P-03, 2026-10-23). The query's `eff` CTE
 * derives each creative's launch day with a correlated MIN(date) subquery.
 * Referenced once, Postgres ≥ 12 INLINES the CTE, and every one of the ~37
 * references to `eff.eff_launch` then re-ran the subquery per joined row
 * (19,847 buffer hits vs 139 materialized, on 547 local rows). The plan must
 * keep the CTE materialized — a CTE Scan node — and the rows must not change.
 */
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { launchFatigue } from "@/db/queries/performance";
import { CREATIVE_1, resetAndSeed } from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
});

describe("launchFatigue", () => {
  it("derives a launch from the first non-excluded day", async () => {
    const rows = await launchFatigue({});
    const c1 = rows.find((r) => r.creativeId === CREATIVE_1)!;
    expect(c1.derived).toBe(true);
    expect(c1.launchDate).toBe("2026-01-01");
    expect(c1.daysSinceLaunch).toBeGreaterThan(0);
  });

  it("runs the launch derivation ONCE — the CTE stays materialized", async () => {
    const spy = vi.spyOn(db, "execute");
    await launchFatigue({});
    const query = spy.mock.calls.at(-1)![0] as SQL;
    spy.mockRestore();
    const plan = (await db.execute(sql`EXPLAIN (FORMAT JSON) ${query}`)) as unknown as Array<{
      "QUERY PLAN": unknown;
    }>;
    const text = JSON.stringify(plan[0]!["QUERY PLAN"]);
    expect(text).toContain('"Node Type":"CTE Scan"');
    expect(text).toContain('"CTE Name":"eff"');
  });
});
