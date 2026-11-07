"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { Chip } from "@/components/ui/chip";
import { rowsToCsv, todayStamp } from "@/lib/csv-export";
import { plural } from "@/lib/format";
import {
  affectedRowCount,
  groupReport,
  rowsPhrase,
  type ReportEntry,
  type ReportGroup,
} from "@/lib/validation-report";
import { cn } from "@/lib/utils";

const SEVERITY_LABEL: Record<ReportEntry["severity"], string> = {
  FATAL: "Fatal",
  ERROR: "Error",
  WARNING: "Warning",
};

/**
 * The ONE upload validation report (R-012, R-061) — the ads upload and the
 * Store order upload both render it over their own catalogs. Grouped by
 * problem, not by row: "Creative “Hook 07” isn't registered · 38 rows (3, 7,
 * 12 … +35)", with the per-row lines behind a disclosure, the code shown muted
 * (support can grep it), and every entry downloadable as CSV. A caller can
 * add an action per group (`fix`) and for the whole report (`actions`).
 */
export function ValidationReport<E extends ReportEntry>({
  errors,
  warnings,
  fix,
  actions,
  footer,
  filename = "upload-errors",
}: {
  errors: E[];
  warnings: E[];
  /** An action for one group — the place in the app that fixes it. */
  fix?: (group: ReportGroup<E>) => ReactNode;
  /** Actions for the whole report (a template of every missing name …). */
  actions?: ReactNode;
  /** A closing line under the list. */
  footer?: ReactNode;
  /** CSV filename stem; the date is appended. */
  filename?: string;
}) {
  const all = [...errors, ...warnings];
  if (all.length === 0) return null;
  const fatal = errors.some((e) => e.severity === "FATAL");
  const groups = groupReport(all);
  const problems = groups.filter((g) => g.severity !== "WARNING").length;
  const rows = affectedRowCount(errors);

  const csv = rowsToCsv(all, [
    { key: "code", label: "code", value: (e) => e.code },
    { key: "severity", label: "severity", value: (e) => e.severity },
    { key: "row", label: "row", value: (e) => e.row ?? e.rows?.join(" ") ?? null },
    { key: "field", label: "field", value: (e) => e.field ?? null },
    { key: "value", label: "value", value: (e) => e.value ?? null },
    { key: "message", label: "message", value: (e) => e.message },
  ]);

  return (
    <div className="rounded-lg border border-neg/30 bg-neg/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-neg/20 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
          <AlertTriangle className="w-4 h-4 shrink-0 text-neg" />
          <span>
            {fatal ? (
              "This file can’t be imported."
            ) : errors.length > 0 ? (
              <>
                <span className="font-semibold tabular-nums">{plural(problems, "problem")}</span>
                {rows > 0 && <> across <span className="tabular-nums">{plural(rows, "row")}</span></>}
              </>
            ) : null}
            {warnings.length > 0 && (
              <span className="text-ink-3">
                {errors.length > 0 ? " · " : ""}
                {plural(warnings.length, "warning")}
              </span>
            )}
            {errors.length > 0 && <span className="text-ink-3"> · No data was imported.</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          <DownloadCsvButton
            csvContent={csv}
            filename={`${filename}-${todayStamp()}.csv`}
            label="Download errors"
          />
        </div>
      </div>

      <ul className="max-h-96 overflow-y-auto divide-y divide-neg/10 text-xs">
        {groups.map((g) => (
          <GroupRow key={g.key} group={g} action={fix?.(g)} />
        ))}
      </ul>

      {footer && (
        <div className="px-4 py-2 border-t border-neg/20 text-[11px] text-ink-3">{footer}</div>
      )}
    </div>
  );
}

function GroupRow<E extends ReportEntry>({
  group,
  action,
}: {
  group: ReportGroup<E>;
  action?: ReactNode;
}) {
  const isWarn = group.severity === "WARNING";
  const where = rowsPhrase(group.rows);
  return (
    <li className={cn("px-4 py-2", isWarn && "bg-warn/5")}>
      <div className="flex items-start gap-3">
        <Chip tone={isWarn ? "warn" : "neg"} className="mt-0.5">
          {SEVERITY_LABEL[group.severity]}
        </Chip>
        <span className="min-w-0 flex-1 text-ink-2 leading-relaxed break-words">
          <span className="font-mono text-ink-3">{group.code}</span> · {group.headline}
          {where && <span className="tabular-nums text-ink-3"> · {where}</span>}
        </span>
        {action && <span className="shrink-0">{action}</span>}
      </div>
      {group.entries.length > 1 && (
        <details className="group/rows mt-1 pl-[3.25rem]">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 transition-transform group-open/rows:rotate-90" />
            Show each row
          </summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-ink-3">
            {group.entries.map((e, i) => (
              <li key={i} className="break-words">
                {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
