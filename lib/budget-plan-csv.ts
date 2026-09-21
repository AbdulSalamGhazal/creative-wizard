/**
 * The Plan tab's sheet — template OUT, matrix IN — at DAY grain (2026-09,
 * supersedes 2d45cb3's monthly platform × bucket matrix: there is ONE template).
 * Pure: no DOM, no network, no server.
 *
 * Rows are the month's days (1..N) plus a trailing Reserve row; columns are
 * `Day` then one per platform × bucket combo, headed "Instagram · Awareness
 * (USD)". Both axes DERIVE — `ALL_PLATFORMS` × `BUDGET_OBJECTIVES` and the
 * month's real length — so a new platform or bucket grows the template, the
 * parser and the error messages together. Uploading it plans the month in
 * DAILY mode (see the Budget bullets in CLAUDE.md).
 *
 * The sheet carries MONEY ONLY: the revenue link (target ⇄ ROAS) is typed in
 * the dialog, and the day-weight curve is not in it — a daily month doesn't
 * use one, and the curve of a month that was curve-planned is left dormant.
 *
 * Validation here is FORM validation, deliberately NOT the E/S error catalog
 * in `csv/errors.ts`: that catalog is the contract for the ad-platform
 * ingestion pipelines (stable codes, per-row reports, a spec document). This
 * is one person typing a plan into a grid, and the right answer is an inline
 * message naming the cell they need to fix. Adding config-entry codes to the
 * ingestion catalog would blur what those codes promise.
 */
import { ALL_PLATFORMS, PLATFORM_LABEL, type PlatformKey } from "@/lib/palette";
import { isEmptyMarker, parseNumber } from "@/csv/numeric";
import { matrixToCsv } from "@/lib/csv-export";
import {
  BUDGET_OBJECTIVES,
  allocationsFromDays,
  budgetComboKey,
  dayWeights,
  daysInMonth,
  monthLabel,
  monthStartIso,
  round2,
  splitByWeights,
  type BudgetObjective,
  type PlanDayCell,
  type PlanSeriesSource,
} from "@/lib/budget";

/** Spend is USD everywhere in Budget; every combo header says so. */
export const PLAN_CSV_CURRENCY = "USD";
/** The row-label column's header. */
export const PLAN_CSV_LABEL_HEADER = "Day";
/** The trailing row that carries the reserve. */
export const PLAN_CSV_RESERVE_LABEL = "Reserve";
/** Platform · bucket separator in a combo header. */
const SEP = " · ";

/** A parsed day cell — a real platform and bucket by construction. */
export interface PlanCsvDayCell extends PlanDayCell {
  platform: PlatformKey;
  objective: BudgetObjective;
}

/**
 * The money half of a plan as MONTHLY totals + the reserve — what the preview
 * diffs. `objective` is a plain string on the way in because that is how a
 * stored row is typed; the pair is only ever used as an opaque key.
 */
export interface PlanCsvPlan {
  allocations: ReadonlyArray<{
    platform: string;
    objective: string;
    plannedSpend: number;
  }>;
  reserveSpendUsd: number;
}

/** A single thing wrong with the sheet, addressed to the cell that holds it. */
export interface PlanCsvIssue {
  /** Where to look — "Row 4 · Day 3 · Instagram · Awareness", "Header · column 5". */
  cell: string;
  message: string;
}

export interface PlanCsvParsed {
  /** Sparse: only cells with money. */
  days: PlanCsvDayCell[];
  reserveSpendUsd: number;
  /** Things worth SAYING but not worth refusing — e.g. no Reserve row. */
  notices: string[];
}

export type PlanCsvResult =
  | { ok: true; plan: PlanCsvParsed }
  | { ok: false; issues: PlanCsvIssue[] };

export interface PlanCsvCombo {
  platform: PlatformKey;
  objective: BudgetObjective;
  header: string;
}

/** "Instagram · Awareness (USD)" — the currency is never left to be assumed. */
export function planCsvComboHeader(platform: PlatformKey, objective: BudgetObjective): string {
  return `${PLATFORM_LABEL[platform]}${SEP}${objective} (${PLAN_CSV_CURRENCY})`;
}

/** Every combo column, platforms outer, buckets inner — derived, never listed. */
export function planCsvCombos(): PlanCsvCombo[] {
  return ALL_PLATFORMS.flatMap((platform) =>
    BUDGET_OBJECTIVES.map((objective) => ({
      platform,
      objective,
      header: planCsvComboHeader(platform, objective),
    })),
  );
}

export function planCsvHeader(): string[] {
  return [PLAN_CSV_LABEL_HEADER, ...planCsvCombos().map((c) => c.header)];
}

/**
 * The cells a month's template is PREFILLED with. A daily month: its cells,
 * verbatim — so download → upload round-trips byte for byte. A curve month:
 * each allocation spread over the days by the curve, CENTS-EXACT
 * (`splitByWeights`), so every column sums to its allocation to the cent and
 * the download is a ready-shaped starting point, seasonality included. (The
 * curve's own pacing math stays unrounded; this is a prefill, not a pace.)
 */
export function planCsvTemplateCells(src: PlanSeriesSource): PlanDayCell[] {
  if (src.planMode === "daily") return src.planDays.map((c) => ({ ...c }));
  const weights = dayWeights(monthStartIso(src.month), src.dayWeights);
  const out: PlanDayCell[] = [];
  for (const a of src.allocations) {
    splitByWeights(a.plannedSpend, weights).forEach((plannedSpend, i) => {
      if (plannedSpend > 0) {
        out.push({ day: i + 1, platform: a.platform, objective: a.objective, plannedSpend });
      }
    });
  }
  return out;
}

/** The template body: day rows (blank = no money), then the Reserve row. */
export function planCsvRows(
  month: string,
  cells: ReadonlyArray<PlanDayCell>,
  reserveSpendUsd: number,
): Array<Array<string | number>> {
  const totalDays = daysInMonth(monthStartIso(month));
  const combos = planCsvCombos();
  const at = new Map<string, number>();
  for (const c of cells) {
    const key = `${c.day}|${budgetComboKey(c.platform, c.objective)}`;
    at.set(key, (at.get(key) ?? 0) + c.plannedSpend);
  }
  const rows: Array<Array<string | number>> = [];
  for (let day = 1; day <= totalDays; day++) {
    rows.push([
      day,
      ...combos.map((c) => {
        const v = at.get(`${day}|${budgetComboKey(c.platform, c.objective)}`);
        // No money is BLANK, not "0" — blank reads back as zero, and a sheet
        // of 600 zeros is noise.
        return v === undefined || v === 0 ? "" : round2(v);
      }),
    ]);
  }
  rows.push([
    PLAN_CSV_RESERVE_LABEL,
    reserveSpendUsd > 0 ? round2(reserveSpendUsd) : "",
    ...combos.slice(1).map(() => ""),
  ]);
  return rows;
}

/** The whole template as CSV text (RFC-4180 quoting via the shared writer). */
export function planCsvTemplate(
  month: string,
  cells: ReadonlyArray<PlanDayCell>,
  reserveSpendUsd: number,
): string {
  return matrixToCsv(planCsvHeader(), planCsvRows(month, cells, reserveSpendUsd));
}

/** `budget-plan-2026-09-daily.csv` — the month is in the name, like every export. */
export function planCsvFilename(month: string): string {
  return `budget-plan-${month}-daily.csv`;
}

/** Trimmed, inner whitespace collapsed, lowercased — for name matching. */
function norm(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Platform display label OR storage key, case-insensitively. */
const PLATFORM_BY_NAME: ReadonlyMap<string, PlatformKey> = new Map(
  ALL_PLATFORMS.flatMap((p) => [
    [norm(PLATFORM_LABEL[p]), p] as const,
    [norm(p), p] as const,
  ]),
);

const OBJECTIVE_BY_NAME: ReadonlyMap<string, BudgetObjective> = new Map(
  BUDGET_OBJECTIVES.map((o) => [norm(o), o] as const),
);

/**
 * A combo header → its platform and bucket. Only the `(USD)` suffix is
 * stripped: a column headed "… (SAR)" must fail as unknown rather than
 * quietly load SAR figures into a USD plan.
 */
function comboOfHeader(raw: string): { platform: PlatformKey; objective: BudgetObjective } | null {
  const cleaned = norm(raw).replace(
    new RegExp(`\\s*\\(${PLAN_CSV_CURRENCY.toLowerCase()}\\)$`, "u"),
    "",
  );
  const parts = cleaned.split("·").map((x) => x.trim());
  if (parts.length !== 2) return null;
  const platform = PLATFORM_BY_NAME.get(parts[0]!);
  const objective = OBJECTIVE_BY_NAME.get(parts[1]!);
  return platform && objective ? { platform, objective } : null;
}

/** "3" or "Day 3" → 3; anything else → null. */
function dayOfLabel(raw: string): number | null {
  const m = norm(raw).match(/^(?:day\s*)?(\d{1,2})$/u);
  return m ? Number(m[1]) : null;
}

/** Every cell in the row is blank — a spacer, not a statement. */
function rowIsBlank(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

/** [1,2,3,7,9,10] → "1–3, 7, 9–10" — how a person reads a list of days. */
export function dayRanges(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * Read an uploaded day-grain sheet for `month`.
 *
 * Strict where silence would lose money — an unrecognised combo column or
 * row label is an ERROR, never dropped, and the Day column must be exactly
 * 1..N once each — and lenient only where the spreadsheet is at fault rather
 * than the author: a row SHORT of cells is padded with blanks (editors trim
 * trailing commas), while a row with cells to spare is refused. Every bad cell
 * is collected in one pass.
 *
 * `rowOffset` is the file row number of the first BODY row (the header is
 * row 1), so a message points at the file the author is looking at.
 */
export function parsePlanCsvMatrix(
  header: readonly string[],
  body: ReadonlyArray<readonly string[]>,
  month: string,
  rowOffset = 2,
): PlanCsvResult {
  const issues: PlanCsvIssue[] = [];
  const combos = planCsvCombos();
  const expected = 1 + combos.length;
  const totalDays = daysInMonth(monthStartIso(month));
  const monthName = monthLabel(month.slice(0, 7));

  if (header.length === 0 || (header.length === 1 && header[0]!.trim() === "")) {
    return { ok: false, issues: [{ cell: "File", message: "This file has no header row." }] };
  }

  // ── Columns ──────────────────────────────────────────────────────────────
  const columnCombo: Array<{ platform: PlatformKey; objective: BudgetObjective } | null> = [null];
  const seen = new Map<string, number>();
  for (let c = 1; c < header.length; c++) {
    const raw = header[c] ?? "";
    const combo = comboOfHeader(raw);
    if (!combo) {
      issues.push({
        cell: `Header · column ${c + 1}`,
        message: `"${raw.trim() || "(blank)"}" isn't a platform · bucket column. Expected e.g. "${combos[0]!.header}".`,
      });
      columnCombo.push(null);
      continue;
    }
    const key = budgetComboKey(combo.platform, combo.objective);
    const already = seen.get(key);
    if (already !== undefined) {
      issues.push({
        cell: `Header · column ${c + 1}`,
        message: `${planCsvComboHeader(combo.platform, combo.objective)} appears twice (also column ${already + 1}).`,
      });
      columnCombo.push(null);
      continue;
    }
    seen.set(key, c);
    columnCombo.push(combo);
  }
  const missing = combos.filter((c) => !seen.has(budgetComboKey(c.platform, c.objective)));
  if (missing.length > 0) {
    issues.push({
      cell: "Header",
      message: `Missing ${missing.length === 1 ? "a column" : `${missing.length} columns`}: ${missing
        .map((c) => c.header)
        .join(", ")}. Every platform · bucket needs its column (leave it blank to plan nothing).`,
    });
  }
  if (issues.length > 0 && header.length !== expected) {
    // The shape is wrong at the root — per-row noise would bury that.
    return {
      ok: false,
      issues: [
        {
          cell: "Header",
          message: `Expected ${expected} columns (Day + ${combos.length} platform · bucket columns) — this file has ${header.length}. Download the template to get the right shape.`,
        },
        ...issues,
      ],
    };
  }

  // ── Rows ─────────────────────────────────────────────────────────────────
  const days: PlanCsvDayCell[] = [];
  const seenDay = new Map<number, number>();
  let reserve: number | null = null;
  let reserveRow: number | null = null;

  body.forEach((rawCells, i) => {
    const fileRow = i + rowOffset;
    if (rowIsBlank(rawCells)) return;
    if (rawCells.length > header.length) {
      issues.push({
        cell: `Row ${fileRow}`,
        message: `This row has ${rawCells.length} cells; the sheet has ${header.length} columns. Nothing past column ${header.length} would be read.`,
      });
      return;
    }
    // Short rows are padded — trailing empties are what editors drop.
    const cells = Array.from({ length: header.length }, (_, c) => rawCells[c] ?? "");
    const label = (cells[0] ?? "").trim();

    if (norm(label) === norm(PLAN_CSV_RESERVE_LABEL)) {
      const where = `Row ${fileRow} · ${PLAN_CSV_RESERVE_LABEL}`;
      if (reserveRow !== null) {
        issues.push({ cell: where, message: `The reserve is already set on row ${reserveRow}. Keep one Reserve row.` });
        return;
      }
      reserveRow = fileRow;
      // ONE monthly amount, in the first value cell; money anywhere else in
      // the row would be read by nobody, so say so instead of dropping it.
      const extra = cells
        .map((v, c) => ({ v, c }))
        .filter(({ v, c }) => c >= 2 && !isEmptyMarker(v))
        .map(({ c }) => c + 1);
      if (extra.length > 0) {
        issues.push({
          cell: where,
          message: `The reserve is one monthly amount — put it in column 2 only (found values in column ${extra.join(", ")}).`,
        });
        return;
      }
      const value = readAmount(cells[1] ?? "", where, issues);
      if (value !== null) reserve = value;
      return;
    }

    const day = dayOfLabel(label);
    if (day === null || day < 1 || day > totalDays) {
      issues.push({
        cell: `Row ${fileRow}`,
        message: `"${label || "(blank)"}" isn't a day of ${monthName} (1–${totalDays}) or ${PLAN_CSV_RESERVE_LABEL}.`,
      });
      return;
    }
    const already = seenDay.get(day);
    if (already !== undefined) {
      issues.push({
        cell: `Row ${fileRow} · Day ${day}`,
        message: `Day ${day} already has a row (row ${already}). Keep one row per day.`,
      });
      return;
    }
    seenDay.set(day, fileRow);

    for (let c = 1; c < header.length; c++) {
      const combo = columnCombo[c];
      if (!combo) continue; // the column already has its own error
      const where = `Row ${fileRow} · Day ${day} · ${PLATFORM_LABEL[combo.platform]} · ${combo.objective}`;
      const value = readAmount(cells[c] ?? "", where, issues);
      if (value !== null && value > 0) {
        days.push({ day, platform: combo.platform, objective: combo.objective, plannedSpend: value });
      }
    }
  });

  const missingDays = Array.from({ length: totalDays }, (_, i) => i + 1).filter(
    (d) => !seenDay.has(d),
  );
  if (missingDays.length > 0) {
    issues.push({
      cell: "Day column",
      message:
        seenDay.size === 0
          ? `No day rows — the sheet needs one row for each day 1–${totalDays} of ${monthName}.`
          : `Missing day${missingDays.length === 1 ? "" : "s"} ${dayRanges(missingDays)} — the sheet needs every day 1–${totalDays} of ${monthName} once (leave a day blank to plan nothing).`,
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const notices: string[] = [];
  if (reserveRow === null) {
    // Absent is not wrong — a plan can hold nothing back. Full-replace
    // semantics make it a real statement, so it is SAID, not refused.
    notices.push(`No ${PLAN_CSV_RESERVE_LABEL} row in the file — the reserve will be set to $0.`);
  }
  days.sort(
    (a, b) =>
      a.day - b.day ||
      ALL_PLATFORMS.indexOf(a.platform) - ALL_PLATFORMS.indexOf(b.platform) ||
      BUDGET_OBJECTIVES.indexOf(a.objective) - BUDGET_OBJECTIVES.indexOf(b.objective),
  );
  return { ok: true, plan: { days, reserveSpendUsd: reserve ?? 0, notices } };
}

/**
 * One money cell. Blank is 0 (the system-wide convention), the reading is the
 * adapters' tolerant one ($, thousands separators, a trailing unit), and
 * anything else is named where it sits.
 */
function readAmount(raw: string, where: string, issues: PlanCsvIssue[]): number | null {
  if (isEmptyMarker(raw)) return 0;
  const n = parseNumber(raw);
  if (n === null) {
    issues.push({ cell: where, message: `"${raw.trim()}" isn't a number.` });
    return null;
  }
  if (n < 0) {
    issues.push({ cell: where, message: `${raw.trim()} is negative — a plan can't allocate less than nothing.` });
    return null;
  }
  return round2(n);
}

/** A parsed sheet as monthly totals — the SAME derivation the writer uses. */
export function planCsvMonthly(plan: PlanCsvParsed): PlanCsvPlan {
  return { allocations: allocationsFromDays(plan.days), reserveSpendUsd: plan.reserveSpendUsd };
}

/** What the sheet plans, in total — allocated + reserve, by construction. */
export function planCsvTotals(plan: PlanCsvPlan): {
  allocated: number;
  reserve: number;
  total: number;
} {
  const allocated = round2(plan.allocations.reduce((s, a) => s + a.plannedSpend, 0));
  const reserve = round2(plan.reserveSpendUsd);
  return { allocated, reserve, total: round2(allocated + reserve) };
}

/** Planned spend per day (index 0 = day 1) across every combo — the preview bars. */
export function planCsvDayTotals(month: string, cells: ReadonlyArray<PlanDayCell>): number[] {
  const out = new Array<number>(daysInMonth(monthStartIso(month))).fill(0);
  for (const c of cells) if (c.day >= 1 && c.day <= out.length) out[c.day - 1]! += c.plannedSpend;
  return out.map(round2);
}

/** How many day × combo cells differ between two day plans (either side sparse). */
export function changedDayCells(
  current: ReadonlyArray<PlanDayCell>,
  next: ReadonlyArray<PlanDayCell>,
): number {
  const key = (c: PlanDayCell) => `${c.day}|${budgetComboKey(c.platform, c.objective)}`;
  const a = new Map(current.map((c) => [key(c), round2(c.plannedSpend)]));
  const b = new Map(next.map((c) => [key(c), round2(c.plannedSpend)]));
  let changed = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) changed++;
  }
  return changed;
}

// ── The preview's diff ──────────────────────────────────────────────────────

/** Cell/row verdicts, in the revisions drawer's language: current → uploaded. */
export type PlanChange = "same" | "changed" | "added" | "removed";

export interface PlanDiffCell {
  objective: BudgetObjective;
  /** What the month holds now, and what the sheet would make it. */
  prev: number;
  next: number;
  change: PlanChange;
}

export interface PlanDiffRow {
  platform: string;
  label: string;
  cells: PlanDiffCell[];
  prev: number;
  next: number;
  change: PlanChange;
}

export interface PlanCsvDiff {
  /** One row per platform that has money on either side, in ALL_PLATFORMS order. */
  rows: PlanDiffRow[];
  reserve: { prev: number; next: number; change: PlanChange };
  /** How many money cells the upload would move (the reserve counts as one). */
  changedCells: number;
  identical: boolean;
}

function verdict(prev: number, next: number): PlanChange {
  if (prev === next) return "same";
  if (prev === 0) return "added";
  if (next === 0) return "removed";
  return "changed";
}

/**
 * What the upload would DO, cell by cell — the preview's whole job. Written
 * current → uploaded so the arrow points the way the button would move the
 * money, exactly as the revisions drawer writes current → revision.
 *
 * A platform with no money on either side is left out: the sheet always
 * carries all five rows, and listing three empty ones as "unchanged" buries
 * the two that matter.
 */
export function diffPlanCsv(current: PlanCsvPlan, next: PlanCsvPlan): PlanCsvDiff {
  const amountsOf = (plan: PlanCsvPlan) =>
    new Map(plan.allocations.map((a) => [budgetComboKey(a.platform, a.objective), a.plannedSpend]));
  const before = amountsOf(current);
  const after = amountsOf(next);

  const rows: PlanDiffRow[] = [];
  let changedCells = 0;
  for (const platform of ALL_PLATFORMS) {
    const cells = BUDGET_OBJECTIVES.map((objective) => {
      const key = budgetComboKey(platform, objective);
      const prev = round2(before.get(key) ?? 0);
      const value = round2(after.get(key) ?? 0);
      const change = verdict(prev, value);
      if (change !== "same") changedCells++;
      return { objective, prev, next: value, change };
    });
    const prev = round2(cells.reduce((s, c) => s + c.prev, 0));
    const value = round2(cells.reduce((s, c) => s + c.next, 0));
    if (prev === 0 && value === 0) continue;
    rows.push({
      platform,
      label: PLATFORM_LABEL[platform],
      cells,
      prev,
      next: value,
      change: verdict(prev, value),
    });
  }

  const reservePrev = round2(current.reserveSpendUsd);
  const reserveNext = round2(next.reserveSpendUsd);
  const reserveChange = verdict(reservePrev, reserveNext);
  if (reserveChange !== "same") changedCells++;

  return {
    rows,
    reserve: { prev: reservePrev, next: reserveNext, change: reserveChange },
    changedCells,
    identical: changedCells === 0,
  };
}
