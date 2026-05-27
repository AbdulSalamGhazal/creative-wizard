"use client";

import { AlertTriangle, Info } from "lucide-react";
import type { ValidationError } from "@/csv/errors";
import { cn } from "@/lib/utils";

interface Props {
  errors: ValidationError[];
  warnings: ValidationError[];
}

const SEVERITY_LABEL: Record<ValidationError["severity"], string> = {
  FATAL: "Fatal",
  ERROR: "Error",
  WARNING: "Warning",
};

export function ErrorReport({ errors, warnings }: Props) {
  const fatal = errors.find((e) => e.severity === "FATAL");

  return (
    <div className="rounded-lg border border-neg/30 bg-neg/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-neg/20 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-neg" />
        <div className="text-sm text-ink">
          {fatal ? (
            <>The file was rejected before row-by-row checks could run.</>
          ) : (
            <>
              <span className="font-semibold">{errors.length}</span> error
              {errors.length === 1 ? "" : "s"} found.
              {warnings.length > 0 && (
                <>
                  {" "}Plus{" "}
                  <span className="font-semibold">{warnings.length}</span>{" "}
                  warning{warnings.length === 1 ? "" : "s"}.
                </>
              )}{" "}
              No data was imported.
            </>
          )}
        </div>
      </div>

      <ul className="max-h-96 overflow-y-auto divide-y divide-neg/10 text-xs">
        {errors.map((e, i) => (
          <Row key={`e-${i}`} entry={e} />
        ))}
        {warnings.map((w, i) => (
          <Row key={`w-${i}`} entry={w} />
        ))}
      </ul>

      <div className="px-4 py-2 border-t border-neg/20 text-[11px] text-ink-3 num">
        Codes match{" "}
        <code className="font-mono text-ink-2">docs/validation-spec.md</code>{" "}
        §7. Fix the source CSV and try again.
      </div>
    </div>
  );
}

function Row({ entry }: { entry: ValidationError }) {
  const isWarn = entry.severity === "WARNING";
  return (
    <li
      className={cn(
        "px-4 py-2 flex items-start gap-3",
        isWarn ? "bg-warn/5" : "",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center px-1.5 h-5 rounded text-[10px] font-mono shrink-0 mt-0.5",
          isWarn
            ? "bg-warn/15 text-warn border border-warn/30"
            : "bg-neg/15 text-neg border border-neg/30",
        )}
        title={SEVERITY_LABEL[entry.severity]}
      >
        {entry.code}
      </span>
      <span className="text-ink-2 leading-relaxed">
        {entry.message}
      </span>
      {isWarn && <Info className="w-3 h-3 text-ink-3 mt-1 shrink-0" />}
    </li>
  );
}
