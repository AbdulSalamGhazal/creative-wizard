import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import {
  NEVER_PERSIST_FILTER_KEYS,
  VIEW_MARKER_PARAM,
  isSavedViewApplied,
} from "@/validators/user-prefs";
import { parseColumnList, resolveColumnPrefs } from "@/lib/table-columns";
import {
  ADS_HIDEABLE_KEYS,
  joinAdsHidden,
  splitAdsHidden,
} from "@/components/summary/summary-columns";

/**
 * REGRESSION for the columns move (2026-10): the control left the Campaigns
 * toolbar for the table's own corner, and the preference joined the URL — but
 * a saved view is a stored QUERY STRING, so anything that changes how `hide`
 * or `order` parse silently rewrites every view somebody saved.
 */

const DEFAULTS = ["status", "platform", "spend", "roas", "cpm", "cvr"];
const raw = (query: string) => {
  const p = new URLSearchParams(query);
  return (key: string) => p.get(key) ?? undefined;
};

describe("a saved view's columns still round-trip", () => {
  // A view saved before this change: columns in the query, no `sv` of its own
  // (the marker is stamped when the view is APPLIED).
  const VIEW_QUERY =
    "platforms=instagram&sort=spend&dir=desc&hide=cpm,cvr&order=spend,roas,status,platform,cpm,cvr";

  it("parses exactly as it did — the validator is untouched", () => {
    const parsed = portfolioFiltersSchema.parse({
      hide: new URLSearchParams(VIEW_QUERY).get("hide"),
      order: new URLSearchParams(VIEW_QUERY).get("order"),
      sort: "spend",
      dir: "desc",
    });
    expect(parsed.hide).toEqual(["cpm", "cvr"]);
    expect(parsed.order).toEqual([
      "spend",
      "roas",
      "status",
      "platform",
      "cpm",
      "cvr",
    ]);
  });

  it("applies bit-identically when the view is applied, preference ignored", () => {
    const applied = `${VIEW_QUERY}&${VIEW_MARKER_PARAM}=abc123`;
    const read = raw(applied);
    expect(isSavedViewApplied(read)).toBe(true);

    const resolved = resolveColumnPrefs({
      url: {
        hidden: parseColumnList(read("hide")),
        order: parseColumnList(read("order")),
      },
      viewApplied: isSavedViewApplied(read),
      // A preference that would hide something else entirely — the view wins.
      pref: { hidden: ["spend"], order: ["cvr", "cpm"] },
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(resolved.hidden).toEqual(["cpm", "cvr"]);
    expect(resolved.order).toEqual([
      "spend",
      "roas",
      "status",
      "platform",
      "cpm",
      "cvr",
    ]);
  });

  it("a view that hides NOTHING keeps hiding nothing, preference and all", () => {
    // The sharp case: a view's silence about columns is a statement. Without
    // the suppression, a user's own preference would hide columns the view's
    // author deliberately left visible.
    const read = raw(`platforms=tiktok&${VIEW_MARKER_PARAM}=v1`);
    const resolved = resolveColumnPrefs({
      url: { hidden: parseColumnList(read("hide")), order: parseColumnList(read("order")) },
      viewApplied: isSavedViewApplied(read),
      pref: { hidden: ["cpm"], order: [] },
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(resolved).toEqual({ hidden: [], order: [] });
  });

  it("keeps `hide`/`order` out of the remembered-FILTER mechanism", () => {
    // Columns are remembered by their own table (user_table_prefs), never by
    // the filter prefs — two mechanisms, one for each half of a table's state.
    for (const key of ["hide", "sort", "dir"]) {
      expect(NEVER_PERSIST_FILTER_KEYS as readonly string[]).toContain(key);
    }
  });
});

describe("the old toolbar dropdowns are gone", () => {
  // Source-level guards, the house precedent (validators/summary.test.ts does
  // the same for the Ads bar's def list): the whole point of phase 1 is ONE
  // columns UI, so a re-added dropdown should fail a test, not a review.
  it("the campaigns filter bar no longer owns a Columns control", () => {
    const src = readFileSync("components/portfolio/portfolio-filter-bar.tsx", "utf8");
    expect(src).not.toContain("Columns3");
    expect(src).not.toContain("toggleColumn");
    expect(src).not.toContain("CAMPAIGN_TABLE_COLUMNS");
  });

  it("the store orders table is off localStorage and on the shared hook", () => {
    const src = readFileSync("components/store/store-orders-table.tsx", "utf8");
    expect(src).not.toContain("usePersistentHidden");
    expect(src).toContain("useTableColumns");
    expect(src).toContain("TABLE_KEYS.STORE_ORDERS");
  });

  it("every migrated table passes its key through the shared hook", () => {
    for (const file of [
      "components/portfolio/portfolio-table.tsx",
      "components/store/store-orders-table.tsx",
      "components/campaign/campaign-records-table.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("useTableColumns");
      expect(src, file).toContain("cols.tableProps");
    }
  });
});

describe("the grouped twins keep their URL contract (phase 2)", () => {
  it("Ads' four column params round-trip through the flat hidden list", () => {
    // The columns system speaks ONE list; the Ads table speaks four params of
    // three shapes. If this translation drifts, every saved view drifts.
    const parts = {
      identity: ["product", "creator"] as never,
      metrics: ["cpm", "roas"] as never,
      rate: true,
      blended: false,
    };
    const flat = joinAdsHidden(parts);
    expect(flat).toEqual(["product", "creator", "cpm", "roas", "rate"]);
    expect(splitAdsHidden(flat)).toEqual({
      identity: ["product", "creator"],
      metrics: ["cpm", "roas"],
      rate: true,
      blended: false,
    });
  });

  it("round-trips the empty case and ignores keys it doesn't own", () => {
    const empty = { identity: [], metrics: [], rate: false, blended: false } as never;
    expect(joinAdsHidden(empty)).toEqual([]);
    expect(splitAdsHidden([])).toEqual({
      identity: [],
      metrics: [],
      rate: false,
      blended: false,
    });
    // A platform group key lives in the ORDER, never in the hidden list's
    // identity/metric halves.
    expect(splitAdsHidden(["instagram", "total"]).identity).toEqual([]);
    expect(splitAdsHidden(["instagram", "total"]).blended).toBe(true);
  });

  it("a saved view's columns still win over a preference on the Ads table", () => {
    const applied = raw(`hideMetrics=cpm&${VIEW_MARKER_PARAM}=v9`);
    const resolved = resolveColumnPrefs({
      url: { hidden: parseColumnList(applied("hideMetrics")) },
      viewApplied: isSavedViewApplied(applied),
      pref: { hidden: ["roas"], order: ["tiktok", "instagram"] },
      hideable: ADS_HIDEABLE_KEYS,
      defaults: ["instagram", "tiktok"],
    });
    expect(resolved.hidden).toEqual(["cpm"]);
    // …and the view owns the ORDER it doesn't state, too.
    expect(resolved.order).toEqual([]);
  });
});
