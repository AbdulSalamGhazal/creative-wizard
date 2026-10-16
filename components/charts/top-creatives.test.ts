import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rankRows } from "@/components/charts/top-creatives";
import type { LeaderboardRow } from "@/db/queries/performance";

/**
 * REGRESSION for the P3 migration (2026-10): the dashboard's Top-creatives
 * leaderboard moved onto `DataTable`. Its header has never sorted — the
 * RANKING control decides the order — so the ordering rule is the thing worth
 * pinning, along with the two behaviours that are easy to lose in a rewrite:
 * rows missing the ranked metric sink, and the ranked column can't be hidden.
 */

const row = (name: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  creativeId: name,
  name,
  productName: "Serum",
  type: "video",
  status: "active",
  spend: 1000,
  impressions: 80000,
  clicks: 1200,
  conversions: 30,
  conversionValue: 3900,
  cpm: 12.5,
  ctr: 0.015,
  voc: 0.8,
  cvr: 0.04,
  cpa: 33.3,
  roas: 3.9,
  sparkline: [1, 2, 3],
  ...over,
});

const SPEND = { key: "spend", label: "Spend", col: "spend" as const, pick: (r: LeaderboardRow) => r.spend };
const CPM = { key: "cpm", label: "CPM", col: "cpm" as const, pick: (r: LeaderboardRow) => r.cpm, lower: true };
const ROAS = { key: "roas", label: "ROAS", col: "roas" as const, pick: (r: LeaderboardRow) => r.roas };

describe("rankRows — what 'top' means", () => {
  it("ranks a plain metric biggest-first", () => {
    const out = rankRows(
      [row("a", { spend: 100 }), row("b", { spend: 900 }), row("c", { spend: 500 })],
      SPEND,
      10,
    );
    expect(out.map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("ranks a COST metric cheapest-first — top CPM is the lowest", () => {
    const out = rankRows(
      [row("a", { cpm: 20 }), row("b", { cpm: 5 }), row("c", { cpm: 11 })],
      CPM,
      10,
    );
    expect(out.map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("sinks rows that never reported the metric — BOTH directions", () => {
    // An unreported metric is missing information, not a bad score, so it
    // never leads the leaderboard and never wins the cheapest-first ranking
    // by being empty.
    const rows = [row("has", { cpm: 9 }), row("none", { cpm: null }), row("worse", { cpm: 30 })];
    expect(rankRows(rows, CPM, 10).map((r) => r.name)).toEqual(["has", "worse", "none"]);
    const byRoas = [row("has", { roas: 2 }), row("none", { roas: null })];
    expect(rankRows(byRoas, ROAS, 10).map((r) => r.name)).toEqual(["has", "none"]);
  });

  it("cuts to the limit AFTER ordering, never before", () => {
    const rows = [row("a", { spend: 1 }), row("b", { spend: 9 }), row("c", { spend: 5 })];
    expect(rankRows(rows, SPEND, 2).map((r) => r.name)).toEqual(["b", "c"]);
  });

  it("does not mutate the rows it was given", () => {
    const rows = [row("a", { spend: 1 }), row("b", { spend: 9 })];
    const before = rows.map((r) => r.name);
    rankRows(rows, SPEND, 10);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("the table's own structure, after the migration", () => {
  const SRC = readFileSync("components/charts/top-creatives.tsx", "utf8");

  it("is on the shared primitive and the shared columns control", () => {
    expect(SRC).toContain("<DataTable");
    expect(SRC).toContain("TABLE_KEYS.TOP_CREATIVES");
    expect(SRC).toContain("cols.tableProps");
  });

  it("force-shows the metric it is ranked by", () => {
    // "So you can see what you sorted on" — the one behaviour that needed the
    // primitive extended rather than worked around.
    expect(SRC).toContain("lockedVisible: c.key === opt.col");
  });

  it("keeps the RANKING control, and it is not a columns control", () => {
    expect(SRC).toContain("RANK_OPTIONS");
    // The hand-rolled Columns dropdown is gone — one columns UI, on the table.
    expect(SRC).not.toContain("DropdownMenuCheckboxItem");
    expect(SRC).not.toContain("Columns3");
  });

  it("nothing in the header sorts — the ranking IS the order", () => {
    expect(SRC).not.toContain("sortable: true");
    expect(SRC).not.toMatch(/onSort=/);
  });
});
