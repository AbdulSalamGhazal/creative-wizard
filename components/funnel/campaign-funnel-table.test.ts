import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { int, pct, roas as fmtRoas, usd } from "@/lib/format";
import {
  DEFAULT_SORT,
  TEXT_KEYS,
  compareRows,
  firstDir,
  nextSort,
  type SortKey,
} from "@/components/funnel/campaign-funnel-table";
import type { CampaignFunnelRow } from "@/db/queries/funnel";
import type { Platform } from "@/lib/palette";

/**
 * REGRESSION for the P3 migration (2026-10): the per-campaign funnel table
 * moved onto `DataTable`, and the one thing that must not change is which row
 * ends up where. The sort is the WRAPPER's — `compareRows` plus the
 * three-state header cycle — so these pin it directly.
 */

const row = (
  campaign: string,
  platform: Platform,
  over: Partial<CampaignFunnelRow> = {},
): CampaignFunnelRow => ({
  campaign,
  platform,
  spend: 100,
  impressions: 1000,
  clicks: 10,
  landingPageViews: 8,
  addToCart: 4,
  addPayment: 2,
  conversions: 1,
  conversionValue: 300,
  cpm: 100,
  ctr: 0.01,
  voc: 0.8,
  atcRate: 0.5,
  apRate: 0.5,
  purchaseRate: 0.5,
  cvr: 0.125,
  roas: 3,
  spendDelta: { value: 0, pct: null, direction: "flat" } as CampaignFunnelRow["spendDelta"],
  ...over,
});

const order = (rows: CampaignFunnelRow[], key: SortKey, dir: "asc" | "desc") =>
  [...rows]
    .sort((a, b) => (dir === "asc" ? compareRows(a, b, key) : -compareRows(a, b, key)))
    .map((r) => r.campaign);

describe("first-click direction", () => {
  it("text ascends, numbers descend", () => {
    expect([...TEXT_KEYS]).toEqual(["campaign", "platform"]);
    expect(firstDir("campaign")).toBe("asc");
    expect(firstDir("platform")).toBe("asc");
    for (const key of ["spend", "roas", "cvr", "impressions", "clicks"] as SortKey[]) {
      expect(firstDir(key), key).toBe("desc");
    }
  });
});

describe("the three-state header cycle", () => {
  const spendDesc = { key: "spend" as SortKey, dir: "desc" as const };

  it("a NEW column takes its own first direction", () => {
    expect(nextSort(spendDesc, "roas")).toEqual({ key: "roas", dir: "desc" });
    expect(nextSort(spendDesc, "campaign")).toEqual({ key: "campaign", dir: "asc" });
  });

  it("the SAME column goes desc → asc → back to the table's default", () => {
    const first = nextSort(spendDesc, "roas"); // desc
    const second = nextSort(first, "roas"); // asc
    expect(second).toEqual({ key: "roas", dir: "asc" });
    // The third click does NOT flip back to desc — it resets the table.
    expect(nextSort(second, "roas")).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ key: "spend", dir: "desc" });
  });

  it("a text column cycles the same way, from asc", () => {
    const a = nextSort(spendDesc, "campaign"); // asc
    const b = nextSort(a, "campaign"); // desc? no — asc is its first, so…
    // desc → asc is the rule on REPEAT clicks regardless of where it started:
    // from "asc" the next click is the RESET, because the only non-default
    // directions this table offers are the first one and its opposite.
    expect(b).toEqual(DEFAULT_SORT);
  });
});

describe("compareRows — the order this table has always had", () => {
  const rows = [
    row("Beta ➤ Broad", "tiktok", { spend: 300 }),
    row("Alpha ➤ Broad", "instagram", { spend: 100 }),
    row("Gamma ➤ Broad", "instagram", { spend: 200 }),
  ];

  it("sorts campaigns by name", () => {
    expect(order(rows, "campaign", "asc")).toEqual([
      "Alpha ➤ Broad",
      "Beta ➤ Broad",
      "Gamma ➤ Broad",
    ]);
  });

  it("sorts platform by LABEL, then campaign name inside it", () => {
    expect(order(rows, "platform", "asc")).toEqual([
      "Alpha ➤ Broad",
      "Gamma ➤ Broad",
      "Beta ➤ Broad",
    ]);
  });

  it("sorts numbers, biggest first on the first click", () => {
    expect(order(rows, "spend", "desc")).toEqual([
      "Beta ➤ Broad",
      "Gamma ➤ Broad",
      "Alpha ➤ Broad",
    ]);
  });

  it("treats a NULL rate as ZERO — not as missing (today's behaviour)", () => {
    // DataTable's own rule sinks nulls in BOTH directions. This table has
    // never done that, and the migration must not change it: an unreported
    // rate sorts exactly where 0 would, so it LEADS an ascending sort.
    const withNulls = [
      row("Has rate", "instagram", { atcRate: 0.4 }),
      row("No rate", "tiktok", { atcRate: null }),
      row("Zero rate", "instagram", { atcRate: 0 }),
    ];
    expect(order(withNulls, "atcRate", "asc").slice(0, 2).sort()).toEqual([
      "No rate",
      "Zero rate",
    ]);
    expect(order(withNulls, "atcRate", "desc")[0]).toBe("Has rate");
  });

  it("is stable enough to reverse exactly", () => {
    const asc = order(rows, "spend", "asc");
    const desc = order(rows, "spend", "desc");
    expect([...asc].reverse()).toEqual(desc);
  });
});

describe("the totals row still says \u2014 for a step nobody reported", () => {
  // `funnelTotals` keeps an unreported step NULL (pinned in its own tests);
  // what this file owns is that the table RENDERS that null as a dash rather
  // than a fabricated 0%. The google-only case is the whole reason.
  it("every formatter the totals row uses turns null into a dash", () => {
    expect(pct(null)).toBe("\u2014");
    expect(int(null)).toBe("\u2014");
    expect(usd(null)).toBe("\u2014");
    expect(fmtRoas(null)).toBe("\u2014");
  });

  it("the table takes its totals from the shared helper, uncoerced", () => {
    const src = readFileSync("components/funnel/campaign-funnel-table.tsx", "utf8");
    expect(src).toContain("funnelTotals(rows)");
    // No local "?? 0" on a totals value — that is how a dash becomes a zero.
    expect(src).not.toMatch(/totals\.\w+\s*\?\?/);
  });
});
