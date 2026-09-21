"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS } from "@/lib/palette";
import { int, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv-export";
import {
  BUDGET_OBJECTIVES,
  monthLabel,
  planSeriesSourceOf,
  revenueFromRoas,
  roasFromRevenue,
  round2,
} from "@/lib/budget";
import {
  changedDayCells,
  diffPlanCsv,
  parsePlanCsvMatrix,
  planCsvDayTotals,
  planCsvFilename,
  planCsvMonthly,
  planCsvTemplate,
  planCsvTemplateCells,
  planCsvTotals,
  type PlanChange,
  type PlanCsvIssue,
  type PlanCsvParsed,
} from "@/lib/budget-plan-csv";
import { TARGET_ROAS_MAX } from "@/validators/budget";
import { saveBudgetMonth } from "@/app/actions/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import { PlanDayBars, UnitInput } from "@/components/budget/budget-shared";

const NOTE_MAX = 200;
const DEFAULT_NOTE = "Uploaded from file";

/** Target ROAS is stored to 8 dp (numeric(14,8)); the preview uses exactly that. */
const roasStored = (value: number) => Math.round(value * 1e8) / 1e8;
const numeric = (raw: string) => raw.replace(/[^0-9.]/g, "");

/** What the file said, once it parsed — held until the author confirms. */
interface Staged {
  fileName: string;
  plan: PlanCsvParsed;
}

/**
 * The revenue link is DUAL-ENTRY (the reserve's USD ⇄ % is the pattern): a
 * target in SAR or a target ROAS, each deriving the other through the sheet's
 * planned spend and the brand rate. Only the field being typed holds raw text,
 * so the caret is never fought; the other shows the derived value.
 */
interface RevenueEntry {
  source: "revenue" | "roas";
  raw: string;
}

/** The month's day-grain sheet, prefilled — curve months come out curve-shaped. */
export function downloadPlanSheet(month: string, data: BudgetMonthData): void {
  const cells = planCsvTemplateCells(planSeriesSourceOf(data, month));
  downloadCsv(planCsvFilename(month), planCsvTemplate(month, cells, data.reserveSpendUsd));
}

/**
 * The Plan tab's sheet path, at DAY grain (supersedes 2d45cb3's monthly
 * matrix): download the month as days × platform·bucket, edit, upload. The
 * upload is a FULL REPLACE that plans the month in DAILY mode, and it is not a
 * second writer — it hands `saveBudgetMonth` a daily plan (source "upload"),
 * which inherits `planSchema` validation, the revision snapshot and the
 * `budget.update` audit. The allocations are derived from the cells by the
 * writer; the day weights are left alone (dormant while the month is daily).
 */
export function BudgetPlanUpload({
  month,
  data,
  triggerLabel = "Upload plan…",
}: {
  month: string;
  data: BudgetMonthData;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [issues, setIssues] = useState<PlanCsvIssue[]>([]);
  const [entry, setEntry] = useState<RevenueEntry>({ source: "revenue", raw: "" });
  const [note, setNote] = useState(DEFAULT_NOTE);
  const fileRef = useRef<HTMLInputElement>(null);

  const rate = data.usdToSarRate;
  const isDaily = data.planMode === "daily";
  const current = { allocations: data.allocations, reserveSpendUsd: data.reserveSpendUsd };

  const reset = () => {
    setStaged(null);
    setIssues([]);
    setNote(DEFAULT_NOTE);
    // Prefill with what the month STORES: a daily month's ROAS, a curve
    // month's SAR target.
    setEntry(
      isDaily && data.targetRoas !== null
        ? { source: "roas", raw: String(data.targetRoas) }
        : { source: "revenue", raw: data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar) },
    );
    if (fileRef.current) fileRef.current.value = "";
  };

  const openDialog = () => {
    reset();
    setOpen(true);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStaged(null);
    setIssues([]);
    // papaparse loads HERE, not with the page — it is worth nothing until
    // somebody picks a file (a static import cost /budget/plan ~6 kB).
    const { default: Papa } = await import("papaparse");
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const rows = result.data.filter(Array.isArray);
        const [head, ...body] = rows;
        const parsed = parsePlanCsvMatrix(head ?? [], body, month);
        if (!parsed.ok) {
          setIssues(parsed.issues);
          return;
        }
        setStaged({ fileName: file.name, plan: parsed.plan });
      },
      error: (err: Error) => {
        setIssues([{ cell: "File", message: err.message || "That file could not be read." }]);
      },
    });
  };

  // ── Derived preview ─────────────────────────────────────────────────────────
  const monthly = staged ? planCsvMonthly(staged.plan) : null;
  const totals = monthly ? planCsvTotals(monthly) : null;
  const diff = monthly ? diffPlanCsv(current, monthly) : null;
  const spend = totals?.allocated ?? 0;
  const currentCells = planCsvTemplateCells(planSeriesSourceOf(data, month));
  const cellsChanged = staged ? changedDayCells(currentCells, staged.plan.days) : 0;
  const dayTotals = staged ? planCsvDayTotals(month, staged.plan.days) : [];

  const typed = entry.raw.trim() === "" ? null : Number(entry.raw);
  const typedValid = typed === null || (Number.isFinite(typed) && typed >= 0);
  // The ROAS is what's STORED (8 dp); the revenue target is derived from it,
  // so the preview shows the target exactly as it will read back.
  const targetRoas: number | null = (() => {
    if (typed === null || !typedValid || spend <= 0) return null;
    if (entry.source === "roas") return typed > 0 ? roasStored(typed) : null;
    const r = roasFromRevenue(typed, spend, rate);
    return r !== null && r > 0 ? roasStored(r) : null;
  })();
  const targetRevenue = targetRoas === null ? null : revenueFromRoas(targetRoas, spend, rate);
  const roasTooHigh = targetRoas !== null && targetRoas > TARGET_ROAS_MAX;
  const revenueUnlinkable = typed !== null && typed > 0 && spend <= 0;

  const revenueField =
    entry.source === "revenue" ? entry.raw : targetRevenue === null ? "" : String(targetRevenue);
  // Shown to 4 dp when derived — the stored 8 are for the round trip, not reading.
  const roasField =
    entry.source === "roas"
      ? entry.raw
      : targetRoas === null
        ? ""
        : String(Math.round(targetRoas * 1e4) / 1e4);

  const blocked = !staged || isPending || !typedValid || roasTooHigh;

  const apply = async () => {
    if (!staged || blocked) return;
    setIsPending(true);
    try {
      const res = await saveBudgetMonth({
        month,
        mode: "daily",
        source: "upload",
        days: staged.plan.days,
        // Derived by the writer from the days; sent empty on purpose.
        allocations: [],
        plannedRevenueSar: targetRevenue,
        reserveSpendUsd: staged.plan.reserveSpendUsd,
        targetRoas,
        dayWeights: [],
        note: note.trim() === "" ? undefined : note.trim(),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not apply the uploaded plan");
        return;
      }
      toast.success(`${monthLabel(month)} is now planned day by day, from ${staged.fileName}`);
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
        <Upload className="h-3.5 w-3.5" />
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        {/* The preview can be tall — the dialog scrolls rather than growing
            past a phone's viewport. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload {monthLabel(month)}&rsquo;s plan, day by day</DialogTitle>
            <DialogDescription>
              A sheet of days × platform · bucket, in USD. Uploading REPLACES{" "}
              {monthLabel(month)}&rsquo;s allocations and reserve entirely and plans it day
              by day; it is recorded as a plan revision you can roll back.
            </DialogDescription>
          </DialogHeader>

          {/* `min-w-0`: DialogContent is a grid, and a grid item's automatic
              minimum is its content — without this the preview matrix's
              min-width widens the whole dialog and the DIALOG scrolls
              sideways on a phone instead of the table's own container. */}
          <div className="min-w-0 space-y-4">
            {/* ── 1. The template ──────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadPlanSheet(month, data)}
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </Button>
              <p className="min-w-0 flex-1 basis-48 text-[11px] text-ink-3">
                {isDaily
                  ? `Prefilled with ${monthLabel(month)}'s days exactly as planned.`
                  : `Prefilled with ${monthLabel(month)}'s plan spread across its days by the plan curve — a ready-shaped start.`}{" "}
                Amounts are <span className="text-ink-2">USD</span>.
              </p>
            </div>

            {/* ── 2. The file ──────────────────────────────────────────── */}
            <label className="block space-y-1">
              <span className="text-label text-ink-3">Plan file (.csv)</span>
              <Input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void onFile(e.target.files?.[0])}
                className="h-9 cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-ink-2"
              />
            </label>

            {issues.length > 0 && (
              <div className="space-y-1 rounded-lg border border-neg/40 bg-neg/5 p-3">
                <p className="text-xs font-medium text-neg">
                  {int(issues.length)} {issues.length === 1 ? "problem" : "problems"} in this
                  file — nothing has been changed.
                </p>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {issues.map((i, k) => (
                    <li key={`${i.cell}-${k}`} className="text-[11px] text-ink-2">
                      <span className="num text-ink-3">{i.cell}</span> — {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {staged && totals && diff && (
              <>
                {!isDaily && (
                  <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
                    <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                    <span>
                      This switches {monthLabel(month)} to day-by-day planning; the editor and
                      curve become read-only for it.
                    </span>
                  </p>
                )}

                {/* ── 3. The revenue link (typed, never in the sheet) ───── */}
                <div className="space-y-1">
                  <span className="text-label text-ink-3">Revenue target</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <UnitInput
                      unit="SAR"
                      inputMode="decimal"
                      value={revenueField}
                      onChange={(e) => setEntry({ source: "revenue", raw: numeric(e.target.value) })}
                      className="h-9"
                      wrapperClassName="w-44"
                      aria-label="Revenue target in SAR"
                    />
                    <span aria-hidden className="text-ink-3">
                      ⇄
                    </span>
                    <UnitInput
                      unit="ROAS"
                      inputMode="decimal"
                      value={roasField}
                      onChange={(e) => setEntry({ source: "roas", raw: numeric(e.target.value) })}
                      className="h-9"
                      wrapperClassName="w-36"
                      aria-label="Target ROAS"
                    />
                  </div>
                  <span className="block text-[11px] text-ink-3">
                    Either one fills the other, through the sheet&rsquo;s {usd(spend)} and the
                    rate {rate.toFixed(2)}. The ROAS is what&rsquo;s kept: each day&rsquo;s revenue
                    target is that day&rsquo;s spend × ROAS.
                  </span>
                  {revenueUnlinkable && (
                    <span className="block text-[11px] text-warn">
                      The sheet plans no spend, so there is nothing for a revenue target to
                      ride on — it will be left empty.
                    </span>
                  )}
                  {roasTooHigh && (
                    <span className="block text-[11px] text-warn">
                      A target ROAS above {TARGET_ROAS_MAX} is almost certainly a typo.
                    </span>
                  )}
                </div>

                {/* ── 4. The preview ───────────────────────────────────── */}
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-sm font-medium text-ink">What this would change</h3>
                    <span className="text-[11px] text-ink-3">
                      {staged.fileName} ·{" "}
                      {cellsChanged === 0
                        ? "no day cell moves"
                        : `${int(cellsChanged)} day ${cellsChanged === 1 ? "cell" : "cells"} changed`}
                    </span>
                  </div>

                  {staged.plan.notices.map((n) => (
                    <p key={n} className="text-[11px] text-warn">
                      {n}
                    </p>
                  ))}

                  {/* Monthly totals per platform × bucket, diffed — the
                      matrix scrolls in its own container on a phone. */}
                  <div className="-mx-1 overflow-x-auto px-1">
                    <table className="w-full min-w-[34rem] text-xs">
                      <thead>
                        <tr className="text-left text-ink-3">
                          <th className="py-1 font-normal">Month total</th>
                          {BUDGET_OBJECTIVES.map((o) => (
                            <th key={o} className="py-1 text-right font-normal">
                              {o}
                            </th>
                          ))}
                          <th className="py-1 text-right font-normal">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {diff.rows.length === 0 && (
                          <tr>
                            <td colSpan={BUDGET_OBJECTIVES.length + 2} className="py-2 text-ink-3">
                              No spend on either side.
                            </td>
                          </tr>
                        )}
                        {diff.rows.map((row) => (
                          <tr key={row.platform}>
                            <td className="py-1 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <PlatformDot
                                  platform={row.platform as (typeof ALL_PLATFORMS)[number]}
                                  size="sm"
                                />
                                <span className="text-ink-2">{row.label}</span>
                                <RowMark change={row.change} />
                              </span>
                            </td>
                            {row.cells.map((c) => (
                              <td
                                key={c.objective}
                                className={cn(
                                  "py-1 text-right num tabular-nums whitespace-nowrap",
                                  c.change === "same" ? "text-ink-3" : "text-ink",
                                )}
                              >
                                {c.change === "same" ? (
                                  c.next === 0 ? "—" : usd(c.next)
                                ) : (
                                  <span className="inline-flex items-baseline gap-1">
                                    <span className="text-ink-3 line-through">
                                      {c.prev === 0 ? "—" : usd(c.prev)}
                                    </span>
                                    <span aria-hidden className="text-ink-3">
                                      →
                                    </span>
                                    <span className="text-ink">
                                      {c.next === 0 ? "—" : usd(c.next)}
                                    </span>
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="py-1 text-right num tabular-nums whitespace-nowrap text-ink-2">
                              {usd(row.next)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* The day grain, at a glance — the same bars the tab draws. */}
                  <div className="space-y-1">
                    <span className="text-label text-ink-3">Planned spend per day</span>
                    <PlanDayBars
                      values={dayTotals}
                      label={(v) => usd(v)}
                      ariaLabel={`Planned spend per day, ${usd(spend)} across ${dayTotals.length} days`}
                      className="h-20"
                      tone="data"
                    />
                  </div>

                  {/* ── 5. Totals — the wrong-currency tripwire ─────────── */}
                  <dl className="space-y-1 rounded-lg border border-line bg-surface-2/50 p-3 text-xs">
                    <Line label="Allocated" value={totals.allocated} rate={rate} />
                    <Line
                      label="Reserve"
                      value={totals.reserve}
                      rate={rate}
                      was={diff.reserve.change === "same" ? undefined : diff.reserve.prev}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-1">
                      <dt className="font-medium text-ink">Total budget</dt>
                      <dd className="num tabular-nums text-ink">
                        {usd(totals.total)}{" "}
                        <span className="text-ink-3">· {sar(round2(totals.total * rate))}</span>
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <dt className="text-ink-2">Revenue target</dt>
                      <dd className="num tabular-nums text-ink-2">
                        {targetRevenue === null ? "—" : sar(targetRevenue)}{" "}
                        <span className="text-ink-3">
                          · ROAS {targetRoas === null ? "—" : targetRoas.toFixed(2)}
                        </span>
                      </dd>
                    </div>
                    <p className="text-[11px] text-ink-3">
                      Both currencies are shown on purpose: if the sheet held SAR figures,
                      the USD column is what would be stored. {monthLabel(month)} has spent{" "}
                      {usd(data.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0))} so
                      far.
                    </p>
                  </dl>

                  <p className="text-[11px] text-ink-3">
                    The sheet carries money, not a curve — the month&rsquo;s day weights are
                    left exactly as they are, dormant while it is planned day by day.
                  </p>
                </div>

                <label className="block space-y-1">
                  <span className="text-label text-ink-3">Revision note</span>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                    maxLength={NOTE_MAX}
                    placeholder={DEFAULT_NOTE}
                    className="h-8"
                    aria-label="Revision note"
                  />
                </label>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={blocked}
              title={
                !staged
                  ? "Pick a .csv file first."
                  : !typedValid
                    ? "The revenue target must be a number, and not negative."
                    : roasTooHigh
                      ? `The target ROAS must be at most ${TARGET_ROAS_MAX}.`
                      : undefined
              }
            >
              Replace {monthLabel(month)}&rsquo;s plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The revisions drawer's language, on a row: added · removed · changed. */
function RowMark({ change }: { change: PlanChange }) {
  if (change === "same") return null;
  return (
    <span className="rounded bg-surface-2 px-1 text-eyebrow text-ink-3">
      {change === "added" ? "new" : change === "removed" ? "dropped" : "changed"}
    </span>
  );
}

function Line({
  label,
  value,
  rate,
  was,
}: {
  label: string;
  value: number;
  rate: number;
  was?: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-ink-2">
        {label}
        {was !== undefined && <span className="ml-1.5 num text-ink-3 line-through">{usd(was)}</span>}
      </dt>
      <dd className="num tabular-nums text-ink-2">
        {usd(value)} <span className="text-ink-3">· {sar(round2(value * rate))}</span>
      </dd>
    </div>
  );
}
