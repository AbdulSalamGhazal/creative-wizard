import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — "data fetching lives in `db/queries/*`, not
 * inline in pages", promoted from prose to a test.
 *
 * Why it matters more than tidiness: a query written inline in a component
 * skips the layer where account scoping, the excluded filter and the `max: 1`
 * round-trip discipline are applied and tested. `db/queries/*` is where the
 * tenancy rule is enforced once for everybody; a component holding its own
 * `db` import is a scoping bug waiting for a second brand.
 *
 * KNOWN VIOLATIONS are listed below rather than exempted. The difference is
 * the point: an exemption is a decision, a known violation is a debt, and this
 * list should shrink to empty.
 */

const ROOT = process.cwd();

const KNOWN_VIOLATIONS: Record<string, string> = {
  "components/product/products-admin.tsx":
    "queries `products` inline (db + drizzle + schema) instead of going through db/queries/products.ts — predates this guard; the account scoping it does by hand is the scoping the query layer would give it for free",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

/** A real import of the client or the query builder — not a mention. */
const DB_IMPORT = /^import .*from "(@\/lib\/db|drizzle-orm)"/m;

describe("components do not reach past the query layer", () => {
  const files = walk(path.join(ROOT, "components"));

  it("no component imports the db client or drizzle directly", () => {
    const rogue = files
      .filter((f) => DB_IMPORT.test(readFileSync(path.join(ROOT, f), "utf8")))
      .filter((f) => !(f in KNOWN_VIOLATIONS));
    expect(
      rogue,
      "put the query in db/queries/* — that is where account scoping and the excluded filter are enforced",
    ).toEqual([]);
  });

  it("the known-violations list is still accurate, and still shrinking", () => {
    // If one gets fixed, this fails and the entry comes out — the list is not
    // allowed to quietly outlive the debt it records.
    for (const [f, why] of Object.entries(KNOWN_VIOLATIONS)) {
      expect(
        DB_IMPORT.test(readFileSync(path.join(ROOT, f), "utf8")),
        `${f} no longer reaches past the query layer — delete its entry`,
      ).toBe(true);
      expect(why.length).toBeGreaterThan(40);
    }
    expect(
      Object.keys(KNOWN_VIOLATIONS).length,
      "this list may shrink; it may not grow",
    ).toBeLessThanOrEqual(1);
  });
});
