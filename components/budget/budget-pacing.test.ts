import { describe, expect, it, vi } from "vitest";

/**
 * Budget's pacing surfaces, RENDERED (W1-2…W1-4, 2026-10-23). These are the
 * system audit's render reproductions (B-03, B-04, B-05, B-17) turned into
 * the rule they broke: "Pacing compares against DATA COVERAGE" — each
 * platform (and the store) through ITS OWN last day — and "a total is the SUM
 * of its rows' expectations". Every case failed on the code before the fix.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/budget/analysis",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/user-prefs", () => ({
  setFilterPrefs: async () => ({ ok: true }),
  setTableColumns: async () => ({ ok: true }),
  resetTableColumns: async () => ({ ok: true }),
}));
// Static markup can't open the collapsed Periods section or click a download,
// so both render their contents inline.
vi.mock("@/components/ui/collapsible-section", async () => {
  const React = await import("react");
  return {
    CollapsibleSection: ({ children }: { children: unknown }) =>
      React.createElement("section", null, children as never),
  };
});
vi.mock("@/components/ui/download-csv-button", async () => {
  const React = await import("react");
  return {
    DownloadCsvButton: ({ csvContent, filename }: { csvContent: string; filename: string }) =>
      React.createElement("pre", { "data-file": filename }, csvContent),
  };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetPacing, type GroupBy } from "@/components/budget/budget-pacing";
import { BudgetToday } from "@/components/budget/budget-today";
import { PacingBoard } from "@/components/budget/pacing-board";
import { formatSpend } from "@/components/budget/budget-shared";
import { ALL_PLATFORMS } from "@/lib/palette";
import {
  buildPlanSeries,
  buildPlanSpendPerDay,
  buildRangeBoard,
  buildSpendPerDay,
  isoDaysBetween,
  spendInDisplayCurrency,
  trackerCounts,
} from "@/lib/budget";
import type { BudgetPacingSeries, BudgetProductSpend, MonthPlanRow } from "@/db/queries/budget";

const TODAY = "2026-10-23";
const RATE = 3.75;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ariaOf = (html: string, prefix: string) =>
  [...html.matchAll(new RegExp(`aria-label="(${prefix}:[^"]*)"`, "g"))].map((m) => m[1]!);

/** October 2026, $100/day per planned platform ($3,100 each), linear curve. */
function plan(platforms: string[], over: Partial<MonthPlanRow> = {}): MonthPlanRow {
  return {
    month: "2026-10",
    allocations: platforms.map((platform) => ({ platform, objective: "Awareness", plannedSpend: 3100 })),
    plannedRevenueSar: null,
    reserveSpendUsd: 0,
    dayWeights: {},
    planMode: "curve",
    planDays: [],
    targetRoas: null,
    ...over,
  };
}
const onPlan = (platform: string, through: string) =>
  isoDaysBetween("2026-10-01", through).map((date) => ({
    date,
    platform,
    objective: "Awareness" as const,
    spend: 100,
    // Platform-reported results: 4 purchases worth $300 a day → 3.00× · $25.00.
    purchases: 4 as number | null,
    purchaseValue: 300 as number | null,
  }));
const noRevenue = isoDaysBetween("2026-10-01", "2026-10-31").map((date) => ({ date, revenueSar: 0, orders: 0 }));

function pacing(props: {
  from?: string;
  to?: string;
  coverage: Record<string, string>;
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  platforms?: string[];
  groupBy?: GroupBy;
  storeHorizon?: string | null;
  lens?: "pacing" | "results";
  by?: "platform" | "objective" | "product";
  products?: BudgetProductSpend[] | null;
}) {
  return renderToStaticMarkup(
    createElement(BudgetPacing, {
      from: props.from ?? "2026-10-01",
      to: props.to ?? "2026-10-31",
      groupBy: props.groupBy ?? "day",
      platforms: props.platforms ?? [],
      split: "none",
      shape: "cumulative",
      view: {
        board: "bars",
        rank: "plan",
        group: "platform",
        buckets: [],
        offpace: false,
        lens: props.lens ?? "pacing",
        by: props.by ?? "platform",
      },
      products: props.products ?? null,
      resolved: {},
      coverage: props.coverage,
      canManage: false,
      series: props.series,
      plans: props.plans,
      rate: RATE,
      today: TODAY,
      storeHorizon: props.storeHorizon ?? "2026-10-22",
    }),
  );
}

// Instagram and TikTok each EXACTLY on plan through the day their data covers;
// TikTok's upload lags a week.
const LAGGING = { instagram: "2026-10-22", tiktok: "2026-10-15" };
const laggingSeries: BudgetPacingSeries = {
  spend: [...onPlan("instagram", LAGGING.instagram), ...onPlan("tiktok", LAGGING.tiktok)],
  days: noRevenue,
};

describe("Pacing — spend vs results (platform-reported, 2026-11-14)", () => {
  it("each row carries ROAS · CPA · purchases through ITS OWN day, and the shares panel renders", () => {
    const html = pacing({ coverage: LAGGING, series: laggingSeries, plans: [plan(["instagram", "tiktok"])] });
    // Instagram through the 22nd: 22 days × 4 purchases, $300 / $100 a day.
    expect(html).toContain("Instagram, platform-reported: ROAS 3.00×, $25.00 per purchase, 88 purchases");
    // TikTok's later rows don't exist; its 15 days are its own.
    expect(html).toContain("TikTok, platform-reported: ROAS 3.00×, $25.00 per purchase, 60 purchases");
    // The pacing lens keeps to pacing: the shares live on the results lens.
    expect(html).not.toContain("Where the money works");
    expect(html).toContain("Expected to actual, by platform");
  });

  it("the results lens: shares, the bubble chart and the table — by platform, objective or product", () => {
    const args = { coverage: LAGGING, series: laggingSeries, plans: [plan(["instagram", "tiktok"])] };
    const html = pacing({ ...args, lens: "results" });
    expect(html).toContain("Where the money works");
    // Shares over the two reporting platforms: 2200 / 3700 of spend, 88 / 148 purchases.
    expect(html).toContain("Instagram: 59.5% of spend, 59.5% of purchases");
    expect(html).toContain("Spend against ROAS");
    // The pacing surfaces are gone on this lens.
    expect(html).not.toContain("Pace board");
    const byProduct = pacing({
      ...args,
      lens: "results",
      by: "product",
      products: [
        { platform: "instagram", productId: "p1", productName: "Oud", spend: 2200, purchases: 88, purchaseValue: 6600 },
        { platform: "tiktok", productId: "p2", productName: "Musk", spend: 1500, purchases: 60, purchaseValue: 4500 },
      ],
    });
    expect(byProduct).toContain("Oud: 59.5% of spend, 59.5% of purchases");
    expect(text(byProduct)).toContain("Musk");
  });

  it("a platform that doesn't report purchases reads a dash, never zero", () => {
    const rows = onPlan("instagram", LAGGING.instagram).map((r) => ({ ...r, purchases: null, purchaseValue: null }));
    const html = pacing({
      coverage: { instagram: LAGGING.instagram },
      series: { spend: rows, days: noRevenue },
      plans: [plan(["instagram"])],
    });
    expect(html).toContain("Instagram: the platform reports no purchases");
    expect(html).not.toContain("0 purchases");
    const results = pacing({
      coverage: { instagram: LAGGING.instagram },
      series: { spend: rows, days: noRevenue },
      plans: [plan(["instagram"])],
      lens: "results",
    });
    expect(results).toContain("No platform in this range reports purchases.");
    expect(results).not.toContain("0 purchases");
  });
});

describe("Pacing — the range card anchors each platform to its own day (B-03)", () => {
  it("on-plan spend with one lagging upload reads on track, as the board and the Overview do", () => {
    const html = pacing({ coverage: LAGGING, series: laggingSeries, plans: [plan(["instagram", "tiktok"])] });
    const [card] = ariaOf(html, "Spend");
    // Before: "should be $4,400.00 … behind $700.00; projected to end at $5,213.64".
    expect(card).toContain("should be $3,700.00");
    expect(card).toContain("on track");
    expect(card).toContain("projected to end at $6,200.00");
    for (const row of [...ariaOf(html, "Instagram"), ...ariaOf(html, "TikTok")]) {
      expect(row).toContain("on track");
    }
  });

  it("a planned platform with no data yet expects nothing — the card is live, with no verdict", () => {
    const html = pacing({
      coverage: { tiktok: "2026-10-15" },
      series: { spend: onPlan("tiktok", "2026-10-15"), days: noRevenue },
      plans: [plan(["instagram"])], // TikTok spends unplanned; Instagram hasn't reported
    });
    const [card] = ariaOf(html, "Spend");
    expect(card).toContain("$1,500.00 of $3,100.00");
    expect(card).not.toContain("when it starts");
    expect(card).not.toMatch(/behind|ahead/);
  });

  it("a platform filter scopes the anchor too", () => {
    const html = pacing({
      coverage: LAGGING,
      series: laggingSeries,
      plans: [plan(["instagram", "tiktok"])],
      platforms: ["tiktok"],
    });
    const [card] = ariaOf(html, "Spend");
    // Before: "should be $2,200.00 by 2026-10-22 … behind" while TikTok's row read on track.
    expect(card).toContain("should be $1,500.00");
    expect(card).toContain("on track");
  });
});

function periodsCsv(groupBy: GroupBy): string {
  const html = pacing({
    groupBy,
    coverage: { instagram: "2026-10-22" },
    series: { spend: onPlan("instagram", "2026-10-22"), days: noRevenue },
    plans: [plan(["instagram"])],
  });
  const pre = [...html.matchAll(/<pre data-file="([^"]+)">([\s\S]*?)<\/pre>/g)].find((m) =>
    m[1]!.startsWith("budget-pacing-2026"),
  );
  return pre?.[2] ?? "";
}

describe("Pacing — a partial last Week/Month is judged on the days it covers (B-05)", () => {
  it("Month grouping: on-plan spend through Oct 22 reads on track, not '29% behind'", () => {
    const csv = periodsCsv("month");
    expect(csv).toContain("Oct 2026,2200.00,3100.00,on track");
  });

  it("Week grouping: the partial week reads on track, not '8% behind'", () => {
    const lines = periodsCsv("week").trim().split("\n");
    const partial = lines.find((l) => l.startsWith("Oct 18"))!;
    expect(partial).toContain("on track");
    // The full plan-to-date stays a display figure.
    expect(partial).toContain("2400.00");
  });
});

describe("Today — ROAS divides two sides through the SAME day (B-04)", () => {
  const series: BudgetPacingSeries = {
    spend: onPlan("instagram", "2026-10-22"),
    days: isoDaysBetween("2026-10-01", "2026-10-31").map((date) => ({
      date,
      revenueSar: date <= "2026-10-15" ? 750 : 0,
      orders: date <= "2026-10-15" ? 1 : 0,
    })),
  };
  const today = (over: Partial<MonthPlanRow> = {}, rows = series) =>
    renderToStaticMarkup(
      createElement(BudgetToday, {
        month: "2026-10",
        today: TODAY,
        series: rows,
        plans: [plan(["instagram"], { plannedRevenueSar: 23_250, ...over })],
        rate: RATE,
        storeHorizon: "2026-10-15",
        coverage: { instagram: "2026-10-22" },
        seedMonth: null,
        canManage: false,
        view: { board: "bars", rank: "plan", group: "platform" },
      }),
    );

  it("a month exactly at target with a lagging store upload reads 2.00×, not 1.36× (−32%)", () => {
    const t = text(today());
    const card = t.slice(t.indexOf("ROAS"), t.indexOf("ROAS") + 120);
    expect(card).toContain("ROAS 2.00×");
    expect(card).not.toContain("1.36");
  });

  it("draws the three cards, the last reported day and the ONE pace board", () => {
    const html = today();
    const t = text(html);
    expect(t).toContain("Day 22 of 31");
    expect(t).toContain("Last reported day");
    expect(html).toContain("Instagram, Oct 22: $100 spent of $100 planned");
    expect(t).toContain("Pace board");
    // On plan: nothing wants a decision, so the list isn't drawn.
    expect(t).not.toContain("Needs attention");
  });

  it("a platform far over pace leads Needs attention, with what the reserve can't cover", () => {
    const hot = { ...series, spend: series.spend.map((r) => ({ ...r, spend: 180 })) };
    const t = text(today({ reserveSpendUsd: 1000 }, hot));
    expect(t).toContain("Needs attention");
    // 180 × 31 = 5,580 against 3,100: draws 2,480 of the 1,000 reserve.
    expect(t).toContain("this pace draws $2,480 of $1,000");
    expect(t).toContain("$1,480 over at month end");
    expect(t).toContain("running $180/day");
  });

  it("a month with no plan says what happened and how to plan it", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetToday, {
        month: "2026-10",
        today: TODAY,
        series,
        plans: [plan([])],
        rate: RATE,
        storeHorizon: "2026-10-15",
        coverage: { instagram: "2026-10-22" },
        seedMonth: null,
        canManage: true,
        view: { board: "bars", rank: "plan", group: "platform" },
      }),
    );
    expect(text(html)).toContain("No plan for this month yet.");
    expect(text(html)).toContain("spent");
  });
});

describe("Pacing board — the Table CSV writes the display currency (B-17)", () => {
  it("a file named …-sar.csv holds SAR, to the cent", () => {
    const allocations = [{ platform: "instagram", objective: "Awareness", plannedSpend: 3000 }];
    const series = buildPlanSeries({
      month: "2026-09", planMode: "curve", allocations, plannedRevenueSar: null,
      dayWeights: {}, planDays: [], targetRoas: null, usdToSarRate: RATE,
    });
    const rows = isoDaysBetween("2026-09-01", "2026-09-30").map((date) => ({
      date, platform: "instagram", objective: "Awareness", spend: 100,
    }));
    const every = () => true;
    const board = buildRangeBoard({
      from: "2026-09-01",
      to: "2026-09-30",
      spendPerDay: buildSpendPerDay(rows, every),
      planSpendPerDay: buildPlanSpendPerDay([series], ["instagram"], every),
      platforms: ["instagram"],
      coverage: { instagram: "2026-09-30" },
      today: TODAY,
    });
    const html = renderToStaticMarkup(
      createElement(PacingBoard, {
        from: "2026-09-01", to: "2026-09-30", title: "Sep 1 – Sep 30",
        rows: board.platforms, totalRows: board.platforms.length,
        counts: trackerCounts(board.platforms),
        board: "table", rank: "plan", group: "platform", offPace: false,
        onBoard: () => {}, onRank: () => {}, onGroup: () => {}, onBehind: () => {},
        reserve: { kind: "none" },
        fmt: (usd: number) => formatSpend(usd, "SAR", RATE, { whole: true }),
        fmtCents: (usd: number) => formatSpend(usd, "SAR", RATE),
        toDisplay: (usd: number) => spendInDisplayCurrency(usd, "SAR", RATE),
        currency: "SAR", planMonth: "2026-09", canManage: false,
      }),
    );
    const m = html.match(/<pre data-file="([^"]+)">([\s\S]*?)<\/pre>/)!;
    expect(m[1]).toContain("-sar");
    // Before: "Instagram,3000,3000,3000,0,0,," — USD under a SAR filename.
    expect(m[2]).toContain("Instagram,11250,11250,11250,0,0");
    expect(m[2]).not.toContain(",3000,");
  });
});

describe("Pacing — a past month's aria anchor names the REAL last day of data (W3)", () => {
  it("September is final (anchored to the 30th), but its data stops on the 25th — and says so", () => {
    const sept = isoDaysBetween("2026-09-01", "2026-09-25").map((date) => ({
      date,
      platform: "instagram",
      objective: "Awareness" as const,
      spend: 100,
      purchases: null,
      purchaseValue: null,
    }));
    const html = pacing({
      from: "2026-09-01",
      to: "2026-09-30",
      coverage: { instagram: "2026-09-25" },
      series: { spend: sept, days: noRevenue },
      plans: [plan(["instagram"], { month: "2026-09" })],
      storeHorizon: "2026-09-25",
    });
    const labels = [...ariaOf(html, "Spend"), ...ariaOf(html, "Instagram")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // Before: "… by 2026-09-30 (the last day of data)" — the 30th had no data.
      expect(label).toContain("by 2026-09-30 (data through 2026-09-25)");
      expect(label).not.toContain("(the last day of data)");
    }
  });
});

describe("Pacing — every platform ticked is no filter (W3, D21 seam)", () => {
  // The shared Platforms pill reads "All" when every platform is ticked; the
  // page used to lock Revenue/ROAS behind "All-platforms only" anyway.
  const LOCK = "All-platforms only";
  const props = { coverage: LAGGING, series: laggingSeries, plans: [plan(["instagram", "tiktok"])] };

  it("the full list leaves Revenue and ROAS open, like no selection", () => {
    expect(pacing({ ...props, platforms: [...ALL_PLATFORMS] })).not.toContain(LOCK);
    expect(pacing({ ...props, platforms: [] })).not.toContain(LOCK);
  });

  it("a real subset still locks them, and says why", () => {
    expect(pacing({ ...props, platforms: ["instagram", "tiktok"] })).toContain(LOCK);
  });
});
