import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { ALL_PLATFORMS } from "@/lib/palette";
import {
  BUDGET_OBJECTIVES,
  allocationsFromDays,
  daysInMonth,
  type PlanDayCell,
  type PlanSeriesSource,
} from "@/lib/budget";
import {
  PLAN_CSV_RESERVE_LABEL,
  changedDayCells,
  dayRanges,
  diffPlanCsv,
  parsePlanCsvMatrix,
  planCsvComboHeader,
  planCsvCombos,
  planCsvDayTotals,
  planCsvFilename,
  planCsvHeader,
  planCsvMonthly,
  planCsvRows,
  planCsvTemplate,
  planCsvTemplateCells,
  planCsvTotals,
  type PlanCsvPlan,
} from "@/lib/budget-plan-csv";

const MONTH = "2026-09"; // 30 days
const N = daysInMonth("2026-09-01");
const COLS = 1 + ALL_PLATFORMS.length * BUDGET_OBJECTIVES.length;

/** Parse CSV text exactly the way the dialog does (papaparse, greedy skip). */
function parseText(text: string, month = MONTH) {
  const rows = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  const [head, ...body] = rows;
  return parsePlanCsvMatrix(head ?? [], body, month);
}

/** A blank day-grain body — N day rows of empty cells — to edit in tests. */
function blankBody(month = MONTH): string[][] {
  const n = daysInMonth(`${month}-01`);
  return Array.from({ length: n }, (_, i) => [String(i + 1), ...Array(COLS - 1).fill("")]);
}
const col = (platform: (typeof ALL_PLATFORMS)[number], objective: (typeof BUDGET_OBJECTIVES)[number]) =>
  planCsvHeader().indexOf(planCsvComboHeader(platform, objective));

const sortCells = (cells: readonly PlanDayCell[]) =>
  [...cells]
    .map((c) => `${c.day}|${c.platform}|${c.objective}|${c.plannedSpend}`)
    .sort();

const DAILY: PlanSeriesSource = {
  month: MONTH,
  planMode: "daily",
  allocations: [],
  plannedRevenueSar: null,
  dayWeights: {},
  planDays: [
    { day: 1, platform: "instagram", objective: "Awareness", plannedSpend: 120.55 },
    { day: 1, platform: "google", objective: "Other", plannedSpend: 30 },
    { day: 14, platform: "tiktok", objective: "Retargeting", plannedSpend: 1999.99 },
    { day: 30, platform: "snapchat", objective: "Activation", plannedSpend: 0.01 },
  ],
  targetRoas: 3,
  usdToSarRate: 3.75,
};

const CURVE: PlanSeriesSource = {
  month: MONTH,
  planMode: "curve",
  allocations: [
    { platform: "instagram", objective: "Awareness", plannedSpend: 10000.01 },
    { platform: "facebook", objective: "Retargeting", plannedSpend: 333.33 },
  ],
  plannedRevenueSar: 50000,
  dayWeights: { 10: 3, 25: 2.5 },
  planDays: [],
  targetRoas: null,
  usdToSarRate: 3.75,
};

describe("the day-grain template DERIVES — never hand-listed", () => {
  it("has Day, then a column per platform × bucket (20 today, growing itself)", () => {
    const head = planCsvHeader();
    expect(head[0]).toBe("Day");
    expect(head).toHaveLength(COLS);
    expect(planCsvCombos()).toHaveLength(ALL_PLATFORMS.length * BUDGET_OBJECTIVES.length);
    expect(head).toContain("Instagram · Awareness (USD)");
    // Google is a platform like any other — it grew in by being in ALL_PLATFORMS.
    expect(head).toContain("Google · Other (USD)");
    for (const h of head.slice(1)) expect(h).toMatch(/ \(USD\)$/);
  });

  it("has one row per day of the month, then the Reserve row", () => {
    const rows = planCsvRows(MONTH, [], 500);
    expect(rows).toHaveLength(N + 1);
    expect(rows.slice(0, N).map((r) => r[0])).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(rows.at(-1)![0]).toBe(PLAN_CSV_RESERVE_LABEL);
    expect(rows.at(-1)![1]).toBe(500);
    expect(rows.at(-1)!.slice(2).every((c) => c === "")).toBe(true);
    // February grows the sheet to its own length.
    expect(planCsvRows("2027-02", [], 0)).toHaveLength(28 + 1);
  });

  it("names the month in the file", () => {
    expect(planCsvFilename(MONTH)).toBe("budget-plan-2026-09-daily.csv");
  });
});

describe("round trips — the download is an export", () => {
  it("a DAILY month: generate → parse → the SAME cells, and byte-equal on re-generate", () => {
    const cells = planCsvTemplateCells(DAILY);
    const csv = planCsvTemplate(MONTH, cells, 250);
    const parsed = parseText(csv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(sortCells(parsed.plan.days)).toEqual(sortCells(DAILY.planDays));
    expect(parsed.plan.reserveSpendUsd).toBe(250);
    expect(parsed.plan.notices).toEqual([]);
    // Byte-equal: what comes back generates the identical file.
    expect(planCsvTemplate(MONTH, parsed.plan.days, parsed.plan.reserveSpendUsd)).toBe(csv);
  });

  it("a CURVE month downloads curve-shaped, and every column sums to its allocation EXACTLY", () => {
    const cells = planCsvTemplateCells(CURVE);
    // Seasonality came along: a weight-3 day carries 3× a normal day (±1 cent).
    const ig = (d: number) =>
      cells.find((c) => c.day === d && c.platform === "instagram")!.plannedSpend;
    expect(Math.abs(ig(10) - 3 * ig(9))).toBeLessThanOrEqual(0.03);

    const parsed = parseText(planCsvTemplate(MONTH, cells, 0));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(allocationsFromDays(parsed.plan.days)).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 10000.01 },
      { platform: "facebook", objective: "Retargeting", plannedSpend: 333.33 },
    ]);
    // …and re-uploading an unedited download moves no cell.
    expect(changedDayCells(cells, parsed.plan.days)).toBe(0);
  });

  it("an EMPTY month round-trips too", () => {
    const parsed = parseText(planCsvTemplate(MONTH, [], 0));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.days).toEqual([]);
    expect(parsed.plan.reserveSpendUsd).toBe(0);
  });
});

describe("parsing — the tolerant bits (2d45cb3's conventions carried over)", () => {
  it("BLANK IS ZERO, and so is every empty marker the adapters accept", () => {
    const body = blankBody();
    body[0]![col("instagram", "Awareness")] = "100";
    body[1]![col("instagram", "Awareness")] = "—";
    body[2]![col("instagram", "Awareness")] = "n/a";
    const r = parsePlanCsvMatrix(planCsvHeader(), body, MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.days).toEqual([
      { day: 1, platform: "instagram", objective: "Awareness", plannedSpend: 100 },
    ]);
  });

  it("takes $, thousands separators and a trailing unit", () => {
    const body = blankBody();
    body[0]![col("tiktok", "Other")] = "$1,234.50";
    body[1]![col("tiktok", "Other")] = "2000 USD";
    const r = parsePlanCsvMatrix(planCsvHeader(), body, MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.days.map((d) => d.plannedSpend)).toEqual([1234.5, 2000]);
  });

  it("matches headers and labels case-insensitively and trimmed; columns in any order", () => {
    const head = planCsvHeader().map((h) => `  ${h.toLowerCase()}  `);
    // Swap two columns — they are matched by NAME, not position.
    [head[1], head[2]] = [head[2]!, head[1]!];
    const body = blankBody().map((r, i) => (i === 0 ? [" Day 1 ", "5", "", ...r.slice(3)] : r));
    const r = parsePlanCsvMatrix(head, [...body, [" RESERVE ", "7"]], MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Column 2 now carries the header that was column 3 (Instagram · Activation).
    expect(r.plan.days).toEqual([
      { day: 1, platform: "instagram", objective: "Activation", plannedSpend: 5 },
    ]);
    expect(r.plan.reserveSpendUsd).toBe(7);
  });

  it("accepts a header without the (USD) suffix", () => {
    const head = planCsvHeader().map((h) => h.replace(" (USD)", ""));
    expect(parsePlanCsvMatrix(head, blankBody(), MONTH).ok).toBe(true);
  });

  it("pads a row that lost its trailing commas", () => {
    const body = blankBody().map((r, i) => (i === 4 ? ["5", "42"] : r));
    const r = parsePlanCsvMatrix(planCsvHeader(), body, MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.days[0]).toMatchObject({ day: 5, plannedSpend: 42 });
  });

  it("an ABSENT Reserve row is reserve 0 WITH A NOTICE, not an error", () => {
    const r = parsePlanCsvMatrix(planCsvHeader(), blankBody(), MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.reserveSpendUsd).toBe(0);
    expect(r.plan.notices).toHaveLength(1);
  });

  it("day rows can come in any order", () => {
    const body = blankBody().reverse();
    expect(parsePlanCsvMatrix(planCsvHeader(), body, MONTH).ok).toBe(true);
  });
});

describe("parsing — every error class names its cell", () => {
  const fails = (r: ReturnType<typeof parsePlanCsvMatrix>) => {
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    return r.issues;
  };

  it("unknown row label", () => {
    const body = [...blankBody(), ["Total", "1"]];
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.cell).toBe(`Row ${N + 2}`);
    expect(issues[0]!.message).toContain("Total");
  });

  it("a day that isn't in the month", () => {
    const body = blankBody();
    body[29]![0] = "31"; // September has 30 days — and day 30 is now missing
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues.map((i) => i.message).join(" ")).toContain("1–30");
    expect(issues.some((i) => i.cell === "Day column" && i.message.includes("30"))).toBe(true);
  });

  it("duplicate day, naming the row it collides with", () => {
    const body = blankBody();
    body[5]![0] = "5";
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.cell).toBe("Row 7 · Day 5");
    expect(issues[0]!.message).toContain("row 6");
  });

  it("missing days are listed as ranges", () => {
    const body = blankBody().filter((r) => !["3", "4", "5", "9"].includes(r[0]!));
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.cell).toBe("Day column");
    expect(issues[0]!.message).toContain("3–5, 9");
  });

  it("unknown combo column", () => {
    const head = planCsvHeader();
    head[3] = "Instagram · Consideration (USD)";
    const issues = fails(parsePlanCsvMatrix(head, blankBody(), MONTH));
    expect(issues[0]!.cell).toBe("Header · column 4");
    expect(issues.some((i) => i.message.includes("Missing a column"))).toBe(true);
  });

  it("a SAR column is unknown — the currency is not assumed", () => {
    const head = planCsvHeader();
    head[1] = "Instagram · Awareness (SAR)";
    const issues = fails(parsePlanCsvMatrix(head, blankBody(), MONTH));
    expect(issues[0]!.message).toContain("(SAR)");
  });

  it("duplicate combo column", () => {
    const head = planCsvHeader();
    head[2] = head[1]!;
    const issues = fails(parsePlanCsvMatrix(head, blankBody(), MONTH));
    expect(issues[0]!.message).toContain("twice");
  });

  it("wrong column count leads with the shape it wanted", () => {
    const issues = fails(parsePlanCsvMatrix(planCsvHeader().slice(0, 5), blankBody(), MONTH));
    expect(issues[0]!.cell).toBe("Header");
    expect(issues[0]!.message).toContain(`${COLS} columns`);
  });

  it("non-numeric value", () => {
    const body = blankBody();
    body[2]![col("facebook", "Activation")] = "lots";
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.cell).toBe("Row 4 · Day 3 · Facebook · Activation");
  });

  it("negative value", () => {
    const body = blankBody();
    body[0]![col("google", "Other")] = "-5";
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.message).toContain("negative");
  });

  it("a row with cells to SPARE is refused", () => {
    const body = blankBody();
    body[0] = [...body[0]!, "99"];
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), body, MONTH));
    expect(issues[0]!.cell).toBe("Row 2");
  });

  it("money in the Reserve row's other columns, and a second Reserve row", () => {
    const extra = fails(
      parsePlanCsvMatrix(planCsvHeader(), [...blankBody(), ["Reserve", "10", "5"]], MONTH),
    );
    expect(extra[0]!.message).toContain("one monthly amount");
    const twice = fails(
      parsePlanCsvMatrix(planCsvHeader(), [...blankBody(), ["Reserve", "1"], ["Reserve", "2"]], MONTH),
    );
    expect(twice[0]!.message).toContain("already set");
  });

  it("an empty file, and a header with no day rows", () => {
    expect(fails(parsePlanCsvMatrix([""], [], MONTH))[0]!.cell).toBe("File");
    expect(fails(parsePlanCsvMatrix(planCsvHeader(), [], MONTH))[0]!.message).toContain("No day rows");
  });

  it("collects EVERY bad cell in one pass", () => {
    const body = blankBody();
    body[0]![1] = "x";
    body[1]![2] = "-1";
    const issues = fails(parsePlanCsvMatrix(planCsvHeader(), [...body, ["Nope"]], MONTH));
    expect(issues).toHaveLength(3);
  });
});

describe("preview helpers", () => {
  it("monthly totals are the writer's own derivation (allocationsFromDays)", () => {
    const parsed = { days: DAILY.planDays as never, reserveSpendUsd: 100, notices: [] };
    const monthly = planCsvMonthly(parsed);
    expect(monthly.allocations).toEqual(allocationsFromDays(DAILY.planDays));
    expect(planCsvTotals(monthly)).toEqual({ allocated: 2150.55, reserve: 100, total: 2250.55 });
  });

  it("the diff marks monthly cells changed / added / removed, current → uploaded", () => {
    const current: PlanCsvPlan = {
      allocations: [
        { platform: "instagram", objective: "Awareness", plannedSpend: 100 },
        { platform: "facebook", objective: "Other", plannedSpend: 50 },
      ],
      reserveSpendUsd: 10,
    };
    const next: PlanCsvPlan = {
      allocations: [
        { platform: "instagram", objective: "Awareness", plannedSpend: 150 },
        { platform: "tiktok", objective: "Other", plannedSpend: 70 },
      ],
      reserveSpendUsd: 10,
    };
    const d = diffPlanCsv(current, next);
    expect(d.rows.map((r) => [r.platform, r.change])).toEqual([
      ["instagram", "changed"],
      ["facebook", "removed"],
      ["tiktok", "added"],
    ]);
    expect(d.reserve.change).toBe("same");
    expect(d.changedCells).toBe(3);
  });

  it("day totals feed the bars; changed cells are counted either side", () => {
    const totals = planCsvDayTotals(MONTH, DAILY.planDays);
    expect(totals).toHaveLength(N);
    expect(totals[0]).toBe(150.55);
    const edited = DAILY.planDays.map((c) => (c.day === 14 ? { ...c, plannedSpend: 1 } : c));
    expect(changedDayCells(DAILY.planDays, edited)).toBe(1);
    expect(changedDayCells(DAILY.planDays, [])).toBe(DAILY.planDays.length);
  });

  it("day ranges read like a person wrote them", () => {
    expect(dayRanges([1, 2, 3, 7, 9, 10])).toBe("1–3, 7, 9–10");
    expect(dayRanges([5])).toBe("5");
  });
});
