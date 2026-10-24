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
 * The census (2026-10) found one violation — `products-admin.tsx` querying
 * `products` inline — and it was fixed rather than exempted: the read moved to
 * `listProductsForAdmin()` in the query layer. So this guard carries NO list.
 * There is nothing to argue about at review time: a component that imports the
 * db client is wrong, and the fix is always the same shape.
 */

const ROOT = process.cwd();

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
const DB_IMPORT = /^import [^;]*?from "(@\/lib\/db|drizzle-orm)"/m;

describe("pages and layouts do not reach past the query layer", () => {
  // W3-8 (2026-10): the guard walked components/ only, while the rule names
  // PAGES — and four of them (the dashboard layout's ⌘K list, Upload ads'
  // batches and cleanup pickers, Configuration's rule pickers, the Team
  // page's members) queried inline, the same creative-options read written
  // three times with three column names.
  const routeFiles = walk(path.join(ROOT, "app")).filter((f) =>
    /(^|\/)(page|layout|template|loading|not-found|default)\.tsx$/.test(f),
  );

  it("no page or layout imports the db client or drizzle — no exceptions", () => {
    const rogue = routeFiles.filter((f) =>
      DB_IMPORT.test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(rogue, "move the read into db/queries/* and call it from the page").toEqual([]);
  });

  it("the walk really covers the routes", () => {
    expect(routeFiles).toContain("app/(dashboard)/layout.tsx");
    expect(routeFiles).toContain("app/(dashboard)/uploads/page.tsx");
  });
});

describe("components do not reach past the query layer", () => {
  const files = walk(path.join(ROOT, "components"));

  it("no component imports the db client or drizzle — no exceptions", () => {
    const rogue = files.filter((f) =>
      DB_IMPORT.test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(
      rogue,
      "put the query in db/queries/* — that is where account scoping and the excluded filter are enforced",
    ).toEqual([]);
  });
});
