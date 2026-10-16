import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — the sharpest rule in the aggregation section,
 * promoted from prose to a test.
 *
 * "`excluded_from_aggregates` has exactly TWO sanctioned writers: the manual
 * per-record action (`excluded_source='manual'`) and the exclusion-rules
 * engine (`'rule'` + `excluded_rule_id`) — nothing else may flip it."
 *
 * A third writer would not fail a type check, a build, or any existing test.
 * It would simply make some rows excluded with no provenance, and every
 * aggregate in the app would quietly disagree with the rules page — which is
 * exactly the class of bug that is impossible to find from the symptom.
 */

const ROOT = process.cwd();

/** The two sanctioned writers, plus the schema that declares the column. */
const SANCTIONED: Record<string, string> = {
  "app/actions/exclusion.ts":
    "the MANUAL writer — the per-record exclude/re-include action, which refuses a rule-excluded row",
  "db/queries/exclusion-rules.ts":
    "the RULE engine — applies, un-applies and re-sweeps, always stamping excluded_source='rule'",
  "db/schema.ts": "declares the column and its default; not a writer",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

/**
 * A WRITE is the field set to a LITERAL — the shape every writer has ever
 * used (`.values({ excludedFromAggregates: true })`,
 * `.set({ excludedFromAggregates: false })`).
 *
 * Deliberately narrow: a row mapper (`excludedFromAggregates: r.excluded…`),
 * a type declaration and a `where` clause all mention the field and none of
 * them writes it, and a guard that cried wolf on those would be deleted
 * within a month. The cost is that a writer passing a VARIABLE would slip
 * past — this is a tripwire on the known shape, not a type system.
 */
const WRITE = /excludedFromAggregates:\s*(true|false|sql`)/;

describe("excluded_from_aggregates has exactly two writers", () => {
  const files = ["app", "db", "lib", "components", "csv", "store", "validators"]
    .flatMap((d) => walk(path.join(ROOT, d)));

  it("…and nothing else sets it", () => {
    const writers = files.filter((f) => WRITE.test(readFileSync(path.join(ROOT, f), "utf8")));
    const rogue = writers.filter((f) => !(f in SANCTIONED));
    expect(
      rogue,
      "a third writer leaves rows excluded with no provenance — route it through the action or the rules engine",
    ).toEqual([]);
  });

  it("both sanctioned writers still exist and still write", () => {
    // If one stops writing, the rule has silently changed shape and this test
    // should be re-read rather than quietly passing.
    for (const f of ["app/actions/exclusion.ts", "db/queries/exclusion-rules.ts"]) {
      expect(WRITE.test(readFileSync(path.join(ROOT, f), "utf8")), `${f} no longer writes`).toBe(
        true,
      );
    }
  });

  it("every sanctioned entry carries its reason", () => {
    for (const [f, why] of Object.entries(SANCTIONED)) {
      expect(readdirSync(path.join(ROOT, path.dirname(f)))).toContain(path.basename(f));
      expect(why.length).toBeGreaterThan(20);
    }
  });
});
