"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
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
import { BUDGET_OBJECTIVES, monthLabel, round2 } from "@/lib/budget";
import {
  diffPlanCsv,
  parsePlanCsvMatrix,
  planCsvFilename,
  planCsvTemplate,
  planCsvTotals,
  type PlanCsvIssue,
  type PlanCsvParsed,
  type PlanCsvPlan,
  type PlanChange,
} from "@/lib/budget-plan-csv";
import { saveBudgetMonth } from "@/app/actions/budget";
import { UnitInput } from "@/components/budget/budget-shared";

const NOTE_MAX = 200;
const DEFAULT_NOTE = "Uploaded from file";

/** What the file said, once it parsed — held until the author confirms. */
interface Staged {
  fileName: string;
  plan: PlanCsvParsed;
}

/**
 * The Plan tab's CSV path: download the month's plan as a matrix, edit it in a
 * spreadsheet, upload it back. The upload is a FULL REPLACE of the month's
 * allocations and reserve, and it is deliberately NOT a second writer — it
 * hands `saveBudgetMonth` the same shape the editor does, so it inherits
 * `planSchema` validation, the revision snapshot and the `budget.update` audit
 * (tagged `op: "upload"`).
 *
 * The sheet carries MONEY ONLY. The revenue target is typed here (a user
 * decision — one number does not belong in a matrix) and the day-weight curve
 * is not in the sheet at all: because the write is a full replace, the stored
 * curve is passed straight back through, and the dialog says so.
 */
export function BudgetPlanUpload({
  month,
  current,
  dayWeights,
  plannedRevenueSar,
  actualSpendToDate,
  usdToSarRate,
}: {
  month: string;
  /** The month's plan as it stands — prefills the template, anchors the diff. */
  current: PlanCsvPlan;
  /** Stored day weights, carried across the replace untouched. */
  dayWeights: Record<number, number>;
  plannedRevenueSar: number | null;
  /** The month's spend so far, for context under the totals. */
  actualSpendToDate: number;
  usdToSarRate: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [issues, setIssues] = useState<PlanCsvIssue[]>([]);
  const [revenue, setRevenue] = useState("");
  const [note, setNote] = useState(DEFAULT_NOTE);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStaged(null);
    setIssues([]);
    setNote(DEFAULT_NOTE);
    setRevenue(plannedRevenueSar === null ? "" : String(plannedRevenueSar));
    if (fileRef.current) fileRef.current.value = "";
  };

  const openDialog = () => {
    reset();
    setOpen(true);
  };

  const downloadTemplate = () => {
    downloadCsv(planCsvFilename(month), planCsvTemplate(current));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStaged(null);
    setIssues([]);
    // papaparse is loaded HERE, not with the page: it is ~10 kB gzipped and
    // it is worth nothing until somebody actually picks a file. Keeping the
    // static import would have put all of it in /budget/plan's first load
    // (measured: 29.6 kB → 40 kB) for a dialog most visits never open.
    const { default: Papa } = await import("papaparse");
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const rows = result.data.filter(Array.isArray);
        const [head, ...body] = rows;
        const parsed = parsePlanCsvMatrix(head ?? [], body);
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

  const totals = staged ? planCsvTotals(staged.plan) : null;
  const diff = staged ? diffPlanCsv(current, staged.plan) : null;
  const revenueValue = revenue.trim() === "" ? null : Number(revenue.trim());
  const revenueInvalid =
    revenueValue !== null && (!Number.isFinite(revenueValue) || revenueValue < 0);

  const apply = async () => {
    if (!staged || revenueInvalid) return;
    setIsPending(true);
    try {
      const res = await saveBudgetMonth({
        month,
        allocations: staged.plan.allocations,
        plannedRevenueSar: revenueValue,
        reserveSpendUsd: staged.plan.reserveSpendUsd,
        // The sheet carries money, not the calendar — the stored curve rides
        // through the full replace untouched.
        dayWeights: Object.entries(dayWeights)
          .filter(([, w]) => w !== 1)
          .map(([d, w]) => ({ day: Number(d), weight: w })),
        note: note.trim() === "" ? undefined : note.trim(),
        source: "upload",
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not apply the uploaded plan");
        return;
      }
      toast.success(`${monthLabel(month)}'s plan replaced from ${staged.fileName}`);
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
        Upload plan…
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && (o ? setOpen(true) : setOpen(false))}>
        {/* The preview can be tall — the dialog scrolls rather than growing
            past a phone's viewport. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload {monthLabel(month)}&rsquo;s plan</DialogTitle>
            <DialogDescription>
              A spreadsheet of platforms × buckets in USD. Uploading REPLACES{" "}
              {monthLabel(month)}&rsquo;s allocations and reserve entirely, and is
              recorded as a plan revision you can roll back.
            </DialogDescription>
          </DialogHeader>

          {/* `min-w-0`: DialogContent is a grid, and a grid item's automatic
              minimum is its content — without this the preview matrix's
              min-width widens the whole dialog and the DIALOG scrolls
              sideways on a phone instead of the table's own container. */}
          <div className="min-w-0 space-y-4">
            {/* ── 1. The template ──────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5" />
                Download template
              </Button>
              <p className="min-w-0 flex-1 basis-48 text-[11px] text-ink-3">
                Prefilled with {monthLabel(month)}&rsquo;s plan — edit the amounts and
                upload it back. Amounts are <span className="text-ink-2">USD</span>.
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
                <ul className="space-y-0.5">
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
                {/* ── 3. The revenue target (typed, never in the sheet) ── */}
                <label className="block space-y-1">
                  <span className="text-label text-ink-3">Revenue target</span>
                  <UnitInput
                    unit="SAR"
                    inputMode="decimal"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="h-9"
                    wrapperClassName="max-w-[12rem]"
                    aria-label="Revenue target in SAR"
                  />
                  <span className="block text-[11px] text-ink-3">
                    Typed here, not in the sheet — one monthly total, in SAR.
                    {plannedRevenueSar !== null && (
                      <> Currently {sar(plannedRevenueSar)}.</>
                    )}
                  </span>
                </label>

                {/* ── 4. The preview ───────────────────────────────────── */}
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-sm font-medium text-ink">What this would change</h3>
                    <span className="text-[11px] text-ink-3">
                      {staged.fileName} ·{" "}
                      {diff.identical
                        ? "no money moves"
                        : `${int(diff.changedCells)} ${diff.changedCells === 1 ? "cell" : "cells"}`}
                    </span>
                  </div>

                  {staged.plan.notices.map((n) => (
                    <p key={n} className="text-[11px] text-warn">
                      {n}
                    </p>
                  ))}

                  {/* The matrix, scrolling in its own container so a phone
                      never gets a sideways-scrolling PAGE. */}
                  <div className="-mx-1 overflow-x-auto px-1">
                    <table className="w-full min-w-[34rem] text-xs">
                      <thead>
                        <tr className="text-left text-ink-3">
                          <th className="py-1 font-normal">Platform</th>
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
                              No allocations on either side.
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

                  {/* ── 5. Totals — the wrong-currency tripwire ─────────── */}
                  <dl className="space-y-1 rounded-lg border border-line bg-surface-2/50 p-3 text-xs">
                    <Line
                      label="Allocated"
                      value={totals.allocated}
                      rate={usdToSarRate}
                      change={diff.identical ? "same" : "changed"}
                    />
                    <Line
                      label="Reserve"
                      value={totals.reserve}
                      rate={usdToSarRate}
                      change={diff.reserve.change}
                      was={diff.reserve.prev}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-1">
                      <dt className="font-medium text-ink">Total budget</dt>
                      <dd className="num tabular-nums text-ink">
                        {usd(totals.total)}{" "}
                        <span className="text-ink-3">
                          · {sar(round2(totals.total * usdToSarRate))}
                        </span>
                      </dd>
                    </div>
                    <p className="text-[11px] text-ink-3">
                      Both currencies are shown on purpose: if the sheet held SAR
                      figures, the USD column is what would be stored.
                      {" "}
                      {monthLabel(month)} has spent {usd(actualSpendToDate)} so far.
                    </p>
                  </dl>

                  <p className="text-[11px] text-ink-3">
                    The plan curve is untouched — the sheet carries money, not the
                    calendar. Day weights stay exactly as they are.
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={!staged || isPending || revenueInvalid}
              title={
                staged
                  ? revenueInvalid
                    ? "The revenue target must be a number, and not negative."
                    : undefined
                  : "Pick a .csv file first."
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
  change,
  was,
}: {
  label: string;
  value: number;
  rate: number;
  change: PlanChange;
  was?: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-ink-2">
        {label}
        {change !== "same" && was !== undefined && (
          <span className="ml-1.5 num text-ink-3 line-through">{usd(was)}</span>
        )}
      </dt>
      <dd className="num tabular-nums text-ink-2">
        {usd(value)} <span className="text-ink-3">· {sar(round2(value * rate))}</span>
      </dd>
    </div>
  );
}
