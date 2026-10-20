import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { poolMax } from "@/lib/db";
import { TEST_DATABASE_URL } from "./config";

/**
 * THE DB SUITE RUNS AT PRODUCTION POOL SIZE (2026-10).
 *
 * `lib/db.ts` is `max: 1` on Vercel and `max: 10` in dev. Reactions on creative
 * and campaign comments hung in production for exactly that difference: the
 * action ran a query through the global `db` INSIDE `db.transaction(...)`, and
 * with one connection the transaction holds it — the inner query waits forever.
 * At ten connections it quietly borrowed a second one, so neither dev nor this
 * suite ever saw it. `vitest.config.db.ts` now sets `DB_POOL_MAX=1`; these two
 * tests keep that guard from being removed by accident, and show the mechanism
 * it exists to catch.
 */
describe("the DB suite runs at production pool size", () => {
  it("lib/db is max 1 here, as it is on Vercel", () => {
    expect(process.env.DB_POOL_MAX).toBe("1");
    expect(poolMax()).toBe(1);
  });

  it("at max 1, a query on the outer client inside its own transaction never completes", async () => {
    // A private client, so the deliberately stuck transaction cannot take the
    // shared one down with it.
    const client = postgres(TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const run = client
        .begin(async (tx) => {
          await tx`select 1`;
          await client`select 1`; // the trap: `db`, not `tx`
          return "completed" as const;
        })
        .catch(() => "aborted" as const);
      const outcome = await Promise.race([
        run,
        new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 750)),
      ]);
      expect(outcome).toBe("hung");
    } finally {
      await client.end({ timeout: 0 });
    }
  });
});
