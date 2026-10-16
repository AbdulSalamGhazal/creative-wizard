import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compareRecords } from "@/components/creative/creative-records-table";
import type { CreativeRecordRow } from "@/db/queries/creatives";

/**
 * REGRESSION for the P3 migration (2026-10): the creative-detail records table
 * moved onto `DataTable`, and its all-or-nothing "All columns" toggle became
 * the shared control's `defaultHidden`. The comparator and the two things the
 * toggle used to guarantee are what a rewrite can quietly change.
 */

const row = (over: Partial<CreativeRecordRow> = {}): CreativeRecordRow => ({
  id: 1,
  platform: "instagram",
  campaignName: "Holiday ➤ Broad (IG)",
  date: "2026-10-01",
  spend: 100,
  impressions: 8000,
  clicks: 120,
  conversions: 3,
  conversionValue: 390,
  landingPageViews: 90,
  addToCart: 20,
  addPayment: 10,
  videoViews2s: 400,
  videoViews25: 300,
  videoViews50: 200,
  videoViews75: 150,
  videoViews100: 100,
  excludedFromAggregates: false,
  excludedSource: null,
  excludedReason: null,
  excludedAt: null,
  ...over,
});

const order = (rows: CreativeRecordRow[], key: string, dir: "asc" | "desc") =>
  [...rows]
    .sort((a, b) => (dir === "asc" ? compareRecords(a, b, key) : -compareRecords(a, b, key)))
    .map((r) => r.id);

describe("compareRecords — the order this table has always had", () => {
  it("sorts dates as text, newest first when descending", () => {
    const rows = [
      row({ id: 1, date: "2026-09-01" }),
      row({ id: 2, date: "2026-10-05" }),
      row({ id: 3, date: "2026-09-20" }),
    ];
    expect(order(rows, "date", "desc")).toEqual([2, 3, 1]);
  });

  it("sorts platform by its LABEL, not its key", () => {
    const rows = [
      row({ id: 1, platform: "tiktok" }),
      row({ id: 2, platform: "facebook" }),
      row({ id: 3, platform: "instagram" }),
    ];
    // Facebook · Instagram · TikTok
    expect(order(rows, "platform", "asc")).toEqual([2, 3, 1]);
  });

  it("treats a NULL metric as ZERO — not as missing (today's behaviour)", () => {
    // DataTable's own rule sinks nulls in both directions; this table has
    // never done that, so no column carries a `sortValue` and the wrapper
    // keeps the comparator. A null sorts exactly where 0 would.
    const rows = [
      row({ id: 1, addToCart: 5 }),
      row({ id: 2, addToCart: null }),
      row({ id: 3, addToCart: 0 }),
    ];
    expect(order(rows, "addToCart", "asc").slice(0, 2).sort()).toEqual([2, 3]);
    expect(order(rows, "addToCart", "desc")[0]).toBe(1);
  });

  it("sorts the exclusion provenance, with 'never excluded' as empty", () => {
    const rows = [
      row({ id: 1, excludedReason: "Test traffic" }),
      row({ id: 2, excludedReason: null }),
      row({ id: 3, excludedReason: "Agency audit" }),
    ];
    expect(order(rows, "excludedReason", "asc")).toEqual([2, 3, 1]);
  });
});

describe("what the migration had to keep", () => {
  const SRC = readFileSync("components/creative/creative-records-table.tsx", "utf8");

  it("replaced the all-or-nothing toggle with the shared control", () => {
    expect(SRC).toContain("TABLE_KEYS.CREATIVE_RECORDS");
    expect(SRC).toContain("defaultHidden: DEFAULT_HIDDEN");
    // The old button is gone — one columns UI, on the table. ("All columns"
    // survives only in the comment explaining what it USED to do.)
    expect(SRC).not.toContain("Compact columns");
    expect(SRC).not.toContain("setAllCols");
    expect(SRC).not.toMatch(/>\s*\{?\s*"?All columns/);
  });

  it("offers every uploaded field, with the extended set starting hidden", () => {
    for (const key of [
      "conversionValue",
      "landingPageViews",
      "addToCart",
      "addPayment",
      "videoViews2s",
      "videoViews25",
      "videoViews50",
      "videoViews75",
      "videoViews100",
    ]) {
      expect(SRC, key).toContain(`key: "${key}"`);
    }
    expect(SRC).toContain("METRICS.filter((m) => !m.on)");
  });

  it("keeps the exclude ACTION un-hideable", () => {
    // It is the only way to exclude or re-include a record; a hidden action
    // is an action nobody can find.
    expect(SRC).toMatch(/key: "exclude"[\s\S]{0,400}lockedVisible: true/);
  });

  it("keeps the CSV as the FULL record, independent of the visible columns", () => {
    // The Library's rule: a menu is a reading aid, an export is data.
    expect(SRC).toContain("rowsToCsv(sorted, CSV_COLUMNS)");
    expect(SRC).not.toContain("csvFileName");
    // …and it exports in the on-screen sort, which is why the wrapper sorts.
    expect(SRC).toContain("const sorted = useMemo");
  });

  it("still dims excluded rows and badges them in the identity cell", () => {
    expect(SRC).toContain('r.excludedFromAggregates && "opacity-70"');
    expect(SRC).toMatch(/key: "date"[\s\S]{0,1200}<Badge/);
  });
});
