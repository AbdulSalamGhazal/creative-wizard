import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TABLE_KEYS } from "@/lib/table-columns";

/**
 * REGRESSION for the P3 migration (2026-10): the A/B totals table moved onto
 * `DataTable`. It is a FLAT table of two sides, so the migration is the plain
 * one — but three of its properties are decisions rather than details, and a
 * reviewer reading the component can't tell which is which. These pin them.
 */

const SRC = readFileSync("components/compare/compare-totals-table.tsx", "utf8");

describe("the compare totals table, after the migration", () => {
  it("is on the shared primitive and the shared columns control", () => {
    expect(SRC).toContain("<DataTable");
    expect(SRC).toContain("useTableColumns");
    expect(SRC).toContain("TABLE_KEYS.COMPARE_TOTALS");
    expect(TABLE_KEYS.COMPARE_TOTALS).toBe("compare-totals");
  });

  it("left its per-browser localStorage key behind", () => {
    // One place a column choice lives: the user's account, per brand. The
    // retired key is still NAMED, in the comment that says it was retired and
    // not migrated — what must not come back is a read or a write.
    expect(SRC).not.toMatch(/localStorage\.(get|set|remove)Item/);
    expect(SRC).toMatch(/compare-totals-cols` localStorage key is\s+\*?\s*retired/);
  });

  it("NOTHING sorts — the sides are a pairing, not a ranking", () => {
    // Re-ordering A and B by a metric would break the pairing the colours,
    // the chart and the controls all depend on. No column is sortable and the
    // table takes no `onSort`; a future "make it sortable" should have to
    // delete this test and argue with it.
    expect(SRC).not.toContain("sortable: true");
    expect(SRC).not.toMatch(/onSort=/);
  });

  it("offers every Kpi EXCEPT the funnel-scoped twins, which are named", () => {
    // `funnelCpm`/`funnelCtr` are CPM/CTR restricted to the platforms that
    // report a funnel. Beside their unrestricted twins in the same row they
    // would read as a second, silently different CPM — so they are excluded
    // on purpose, and the reason is written down in the file.
    for (const key of [
      "spend",
      "impressions",
      "clicks",
      "conversions",
      "conversionValue",
      "landingPageViews",
      "ctr",
      "voc",
      "cvr",
      "cpm",
      "cpc",
      "cpa",
      "roas",
      "hookRate",
      "holdRate",
    ]) {
      expect(SRC, key).toContain(`key: "${key}"`);
    }
    expect(SRC).not.toContain('key: "funnelCpm"');
    expect(SRC).not.toContain('key: "funnelCtr"');
    expect(SRC).toContain("funnelCpm");  // …named in the comment that excludes it
  });

  it("ships the same first-visit metrics it always did", () => {
    // The old DEFAULT_VISIBLE list, restated as the columns system's
    // `defaultHidden` — derived from it, never a second hand-kept list.
    expect(SRC).toContain("DEFAULT_VISIBLE");
    expect(SRC).toContain("const DEFAULT_HIDDEN = COLUMNS.filter(");
    expect(SRC).toContain("defaultHidden: DEFAULT_HIDDEN");
  });
});
