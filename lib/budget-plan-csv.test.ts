import { describe, expect, it } from "vitest";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { BUDGET_OBJECTIVES, budgetComboKey } from "@/lib/budget";
import {
  PLAN_CSV_RESERVE_LABEL,
  diffPlanCsv,
  parsePlanCsvMatrix,
  planCsvColumnHeader,
  planCsvFilename,
  planCsvHeader,
  planCsvRows,
  planCsvTemplate,
  planCsvTotals,
  type PlanCsvPlan,
} from "@/lib/budget-plan-csv";

/** Parse a CSV-shaped fixture the way the dialog hands papaparse's output on. */
function parseText(text: string) {
  const [head, ...body] = text
    .trim()
    .split("\n")
    .map((line) => line.split(",").map((c) => c.trim()));
  return parsePlanCsvMatrix(head ?? [], body);
}

const PLAN: PlanCsvPlan = {
  allocations: [
    { platform: "instagram", objective: "Awareness", plannedSpend: 4000 },
    { platform: "instagram", objective: "Activation", plannedSpend: 2500.5 },
    { platform: "facebook", objective: "Retargeting", plannedSpend: 1200 },
    { platform: "google", objective: "Other", plannedSpend: 800 },
  ],
  reserveSpendUsd: 1500,
};

describe("the template derives — never hand-listed", () => {
  it("has a column per budget bucket and a row per platform, plus Reserve", () => {
    const head = planCsvHeader();
    expect(head).toHaveLength(1 + BUDGET_OBJECTIVES.length);
    expect(head.slice(1)).toEqual(BUDGET_OBJECTIVES.map(planCsvColumnHeader));

    const rows = planCsvRows(PLAN);
    expect(rows).toHaveLength(ALL_PLATFORMS.length + 1);
    expect(rows.map((r) => r[0])).toEqual([
      ...ALL_PLATFORMS.map((p) => PLATFORM_LABEL[p]),
      PLAN_CSV_RESERVE_LABEL,
    ]);
    // Google is a platform like any other — it grew into the template by
    // being in ALL_PLATFORMS, which is the whole point.
    expect(rows.some((r) => r[0] === PLATFORM_LABEL.google)).toBe(true);
  });

  it("states the currency in every bucket column", () => {
    for (const cell of planCsvHeader().slice(1)) expect(cell).toContain("(USD)");
  });

  it("prefills the current plan, and writes an empty cell for no money", () => {
    const rows = planCsvRows(PLAN);
    const ig = rows.find((r) => r[0] === PLATFORM_LABEL.instagram)!;
    expect(ig[1]).toBe(4000); // Awareness
    expect(ig[2]).toBe(2500.5); // Activation
    expect(ig[3]).toBe(""); // Retargeting — no money, so blank
    const reserve = rows.at(-1)!;
    expect(reserve[1]).toBe(1500);
    expect(reserve.slice(2)).toEqual(BUDGET_OBJECTIVES.slice(1).map(() => ""));
  });

  it("quotes RFC-4180 style through the shared writer", () => {
    const csv = planCsvTemplate(PLAN);
    expect(csv.split("\n")[0]).toBe(planCsvHeader().join(","));
    expect(planCsvFilename("2026-09")).toBe("budget-plan-2026-09.csv");
  });

  it("ROUND-TRIPS: generate → parse → exactly the plan it came from", () => {
    const result = parseText(planCsvTemplate(PLAN));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same money, cell for cell — the download doubles as an export, so a
    // re-upload that changed nothing must plan nothing new.
    const asMap = (p: { allocations: readonly { platform: string; objective: string; plannedSpend: number }[] }) =>
      Object.fromEntries(
        p.allocations.map((a) => [budgetComboKey(a.platform, a.objective), a.plannedSpend]),
      );
    expect(asMap(result.plan)).toEqual(asMap(PLAN));
    expect(result.plan.reserveSpendUsd).toBe(PLAN.reserveSpendUsd);
    expect(result.plan.notices).toEqual([]);
    expect(diffPlanCsv(PLAN, result.plan).identical).toBe(true);
  });

  it("round-trips an EMPTY plan too — every platform blank, no reserve", () => {
    const empty: PlanCsvPlan = { allocations: [], reserveSpendUsd: 0 };
    const result = parseText(planCsvTemplate(empty));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations).toEqual([]);
    expect(result.plan.reserveSpendUsd).toBe(0);
    // The Reserve row is PRESENT (blank), so there is nothing to notice.
    expect(result.plan.notices).toEqual([]);
  });
});

describe("parsing — the happy path and the tolerant bits", () => {
  it("reads a hand-typed sheet", () => {
    const result = parseText(`Platform,Awareness (USD),Activation (USD),Retargeting (USD),Other (USD)
Instagram,1000,500,,
TikTok,,,250,
Reserve,300,,,`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 1000 },
      { platform: "instagram", objective: "Activation", plannedSpend: 500 },
      { platform: "tiktok", objective: "Retargeting", plannedSpend: 250 },
    ]);
    expect(result.plan.reserveSpendUsd).toBe(300);
  });

  it("BLANK IS ZERO, and so is every empty marker the adapters accept", () => {
    const result = parseText(`Platform,Awareness,Activation,Retargeting,Other
Instagram,100,,—,n/a
Reserve,,,,`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the one real amount survives — zeros carry no money, so no row.
    expect(result.plan.allocations).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 100 },
    ]);
    expect(result.plan.reserveSpendUsd).toBe(0);
  });

  it("takes the adapters' tolerant numerics — a currency symbol", () => {
    // Quote handling is papaparse's job; this is the matrix the dialog hands on.
    const result = parsePlanCsvMatrix(planCsvHeader(), [
      ["Instagram", "$1200.50", "1000", "2500", "3000"],
      ["Reserve", "$500", "", "", ""],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ig = result.plan.allocations.find((a) => a.objective === "Awareness")!;
    expect(ig.plannedSpend).toBe(1200.5);
    expect(result.plan.reserveSpendUsd).toBe(500);
  });

  it("strips thousands separators and trailing units", () => {
    const result = parsePlanCsvMatrix(planCsvHeader(), [
      ["Instagram", "1,234.56", "2000 USD", "", ""],
      ["Reserve", "1,000", "", "", ""],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => a.plannedSpend)).toEqual([1234.56, 2000]);
    expect(result.plan.reserveSpendUsd).toBe(1000);
  });

  it("matches platform and bucket names case-insensitively and trimmed", () => {
    const result = parseText(`  platform ,  awareness (usd) ,ACTIVATION,Retargeting,other
  INSTAGRAM  ,100,,,
tiktok,,50,,
  reserve ,25,,,`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 100 },
      { platform: "tiktok", objective: "Activation", plannedSpend: 50 },
    ]);
    expect(result.plan.reserveSpendUsd).toBe(25);
  });

  it("accepts the header with or without the (USD) suffix", () => {
    const bare = parsePlanCsvMatrix(
      [1, ...BUDGET_OBJECTIVES].map((v, i) => (i === 0 ? "Platform" : String(v))),
      [["Instagram", "10", "", "", ""]],
    );
    expect(bare.ok).toBe(true);
  });

  it("pads a row that lost its trailing commas", () => {
    const result = parsePlanCsvMatrix(planCsvHeader(), [
      ["Instagram", "100"],
      ["Reserve", "50"],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations).toEqual([
      { platform: "instagram", objective: "Awareness", plannedSpend: 100 },
    ]);
    expect(result.plan.reserveSpendUsd).toBe(50);
  });

  it("skips blank spacer rows", () => {
    const result = parsePlanCsvMatrix(planCsvHeader(), [
      ["Instagram", "100", "", "", ""],
      ["", "", "", "", ""],
      ["Reserve", "", "", "", ""],
    ]);
    expect(result.ok).toBe(true);
  });

  it("an ABSENT Reserve row is reserve 0 WITH A NOTICE, not an error", () => {
    const result = parsePlanCsvMatrix(planCsvHeader(), [["Instagram", "100", "", "", ""]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.reserveSpendUsd).toBe(0);
    expect(result.plan.notices).toHaveLength(1);
    expect(result.plan.notices[0]).toMatch(/\$0/);
  });

  it("a platform left out of the sheet simply has no plan (full replace)", () => {
    const result = parsePlanCsvMatrix(planCsvHeader(), [
      ["Instagram", "100", "", "", ""],
      ["Reserve", "", "", "", ""],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => a.platform)).toEqual(["instagram"]);
  });
});

describe("parsing — every error class names its cell", () => {
  const fails = (result: ReturnType<typeof parsePlanCsvMatrix>) => {
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    return result.issues;
  };

  it("unknown platform row", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [["Pinterest", "100", "", "", ""]]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.cell).toBe("Row 2");
    expect(issues[0]!.message).toContain("Pinterest");
  });

  it("unknown objective column", () => {
    const issues = fails(
      parsePlanCsvMatrix(
        ["Platform", "Awareness", "Consideration", "Retargeting", "Other"],
        [["Instagram", "100", "", "", ""]],
      ),
    );
    expect(issues[0]!.cell).toBe("Header · column 3");
    expect(issues[0]!.message).toContain("Consideration");
  });

  it("a SAR column is unknown — the currency is not assumed", () => {
    const issues = fails(
      parsePlanCsvMatrix(
        ["Platform", "Awareness (SAR)", "Activation (USD)", "Retargeting (USD)", "Other (USD)"],
        [["Instagram", "100", "", "", ""]],
      ),
    );
    expect(issues[0]!.message).toContain("Awareness (SAR)");
  });

  it("non-numeric value", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [["Instagram", "lots", "", "", ""]]),
    );
    expect(issues[0]!.cell).toBe("Row 2 · Instagram · Awareness");
    expect(issues[0]!.message).toContain("isn't a number");
  });

  it("negative value", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [["Facebook", "", "-50", "", ""]]),
    );
    expect(issues[0]!.cell).toBe("Row 2 · Facebook · Activation");
    expect(issues[0]!.message).toContain("negative");
  });

  it("duplicate platform row, naming the row it collides with", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [
        ["Instagram", "100", "", "", ""],
        ["instagram", "200", "", "", ""],
      ]),
    );
    expect(issues[0]!.cell).toBe("Row 3 · Instagram");
    expect(issues[0]!.message).toContain("row 2");
  });

  it("duplicate objective column", () => {
    const issues = fails(
      parsePlanCsvMatrix(
        ["Platform", "Awareness", "Awareness", "Retargeting", "Other"],
        [["Instagram", "100", "", "", ""]],
      ),
    );
    expect(issues[0]!.cell).toBe("Header · column 3");
    expect(issues[0]!.message).toContain("twice");
  });

  it("duplicate Reserve row", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [
        ["Reserve", "100", "", "", ""],
        ["Reserve", "200", "", "", ""],
      ]),
    );
    expect(issues[0]!.cell).toContain("Reserve");
  });

  it("wrong column count, with the shape it wanted", () => {
    const issues = fails(parsePlanCsvMatrix(["Platform", "Awareness"], [["Instagram", "1"]]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.cell).toBe("Header");
    expect(issues[0]!.message).toContain(`${1 + BUDGET_OBJECTIVES.length} columns`);
  });

  it("a row with cells to SPARE is refused — nothing is silently unread", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [["Instagram", "1", "", "", "", "900"]]),
    );
    expect(issues[0]!.cell).toBe("Row 2");
    expect(issues[0]!.message).toContain("6 cells");
  });

  it("money in the Reserve row's other columns is refused, not dropped", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [["Reserve", "100", "250", "", ""]]),
    );
    expect(issues[0]!.message).toContain("single amount");
  });

  it("a header with no rows, and an empty file", () => {
    expect(fails(parsePlanCsvMatrix(planCsvHeader(), []))[0]!.cell).toBe("File");
    expect(fails(parsePlanCsvMatrix([""], []))[0]!.cell).toBe("File");
  });

  it("collects EVERY bad cell in one pass — one fix-up, not a guessing game", () => {
    const issues = fails(
      parsePlanCsvMatrix(planCsvHeader(), [
        ["Instagram", "nope", "-5", "", ""],
        ["Nowhere", "1", "", "", ""],
      ]),
    );
    expect(issues).toHaveLength(3);
  });
});

describe("totals and the preview diff", () => {
  it("total = allocated + reserve, by construction", () => {
    expect(planCsvTotals(PLAN)).toEqual({ allocated: 8500.5, reserve: 1500, total: 10000.5 });
  });

  it("marks cells changed / added / removed, current → uploaded", () => {
    const next: PlanCsvPlan = {
      allocations: [
        { platform: "instagram", objective: "Awareness", plannedSpend: 5000 }, // changed
        { platform: "instagram", objective: "Activation", plannedSpend: 2500.5 }, // same
        { platform: "tiktok", objective: "Awareness", plannedSpend: 700 }, // added
        // facebook Retargeting and google Other dropped
      ],
      reserveSpendUsd: 0,
    };
    const diff = diffPlanCsv(PLAN, next);
    const cell = (platform: string, objective: string) =>
      diff.rows.find((r) => r.platform === platform)!.cells.find((c) => c.objective === objective)!;

    expect(cell("instagram", "Awareness")).toMatchObject({ prev: 4000, next: 5000, change: "changed" });
    expect(cell("instagram", "Activation").change).toBe("same");
    expect(cell("tiktok", "Awareness")).toMatchObject({ prev: 0, next: 700, change: "added" });
    expect(cell("facebook", "Retargeting")).toMatchObject({ prev: 1200, next: 0, change: "removed" });

    expect(diff.rows.find((r) => r.platform === "tiktok")!.change).toBe("added");
    expect(diff.rows.find((r) => r.platform === "facebook")!.change).toBe("removed");
    expect(diff.reserve).toEqual({ prev: 1500, next: 0, change: "removed" });
    // 4 allocation cells + the reserve.
    expect(diff.changedCells).toBe(5);
    expect(diff.identical).toBe(false);
  });

  it("leaves out platforms with no money on either side", () => {
    const diff = diffPlanCsv(PLAN, PLAN);
    expect(diff.rows.map((r) => r.platform)).toEqual(["instagram", "facebook", "google"]);
    expect(diff.identical).toBe(true);
    expect(diff.changedCells).toBe(0);
  });
});
