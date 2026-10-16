import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — the raw-SQL rule, rewritten to match reality
 * and then made checkable.
 *
 * The old rule said "no raw SQL except `db/queries/performance.ts`". The
 * census found sixteen files using a `sql` template, so the rule was not being
 * broken — it was simply false, and a false rule teaches people to skim the
 * section it lives in. The real line, the one worth defending, is a LAYER:
 * raw SQL belongs where queries are written and tested, and nowhere a
 * component, a page or a validator can reach it.
 *
 * Each site outside the query layer is named with its reason, because "a
 * one-liner, it's fine" is how a layer rule dies.
 */

const ROOT = process.cwd();

/** Directories where a `sql` template is simply expected. */
const SANCTIONED_DIRS = ["db/queries"];

/** Individual files, each with the reason it needs raw SQL. */
const SANCTIONED_FILES: Record<string, string> = {
  "db/schema.ts": "column defaults (`sql`'{}'::text[]``) — the schema IS SQL",
  "db/seed.ts":
    "demo-data seeding — dev only, and never run against prod (see the Deployment section)",
  "lib/metrics.ts":
    "THE fragment library: every derived-metric expression in the app is defined here exactly once, which is the whole reason the aggregation rule holds",
  "lib/oauth.ts":
    "the single-use authorization code is consumed by ONE atomic `UPDATE … WHERE consumed_at IS NULL RETURNING` — a non-negotiable that cannot be expressed through the query builder",
  "app/actions/audience.ts":
    "`sql`excluded.size`` inside an upsert's `onConflictDoUpdate` — drizzle's way of naming the EXCLUDED pseudo-table; the write belongs in an action, which is where writes live",
  "app/actions/session.ts":
    "`LOWER(email)` for the case-insensitive sign-in lookup — auth is deliberately colocated with the session action rather than split across a query module nobody else would use",
  "app/api/health/route.ts":
    "`select 1` — a liveness probe, not a domain query; routing it through the query layer would test the wrong thing",
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

/** A `sql` tagged template — the thing the rule is about. */
const RAW = /\bsql`/;

describe("raw SQL stays in the layer that owns queries", () => {
  const files = ["app", "components", "db", "lib", "csv", "store", "validators"].flatMap((d) =>
    walk(path.join(ROOT, d)),
  );

  it("…and nowhere a component, page or validator can reach it", () => {
    const users = files.filter((f) => RAW.test(readFileSync(path.join(ROOT, f), "utf8")));
    const rogue = users.filter(
      (f) => !SANCTIONED_DIRS.some((d) => f.startsWith(`${d}/`)) && !(f in SANCTIONED_FILES),
    );
    expect(
      rogue,
      "move it into db/queries/*, or add it above WITH the reason it cannot live there",
    ).toEqual([]);
  });

  it("no component or validator uses raw SQL at all", () => {
    // The sharpest half of the rule, stated separately so it can never be
    // weakened by adding a file to the list above.
    const leaks = files.filter(
      (f) =>
        (f.startsWith("components/") || f.startsWith("validators/")) &&
        RAW.test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(leaks, "a component that writes SQL has skipped account scoping").toEqual([]);
  });

  it("every named exception still exists and still uses raw SQL", () => {
    for (const [f, why] of Object.entries(SANCTIONED_FILES)) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(RAW.test(src), `${f} no longer uses raw SQL — drop its entry`).toBe(true);
      expect(why.length).toBeGreaterThan(30);
    }
  });
});
