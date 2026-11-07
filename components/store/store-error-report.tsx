import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, type StoreValidationError } from "@/store/errors";
import { Chip } from "@/components/ui/chip";

/**
 * Store upload error report — mirrors the ads `ErrorReport` look, but over the
 * Store module's own S-coded errors. Fatals block; errors block; warnings are
 * informational (tinted). Nothing commits while any fatal/error remains.
 */
export function StoreErrorReport({
  errors,
  warnings,
}: {
  errors: StoreValidationError[];
  warnings: StoreValidationError[];
}) {
  const all = [...errors, ...warnings];
  if (all.length === 0) return null;
  const fatal = errors.some((e) => e.severity === "FATAL");

  return (
    <div className="rounded-lg border border-neg/30 bg-neg/5">
      <div className="flex items-center gap-2 border-b border-neg/20 px-4 py-2.5 text-sm text-ink">
        <AlertTriangle className="h-4 w-4 text-neg" />
        {fatal
          ? "This file can't be imported."
          : `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix`}
        {warnings.length > 0 && (
          <span className="text-ink-3">· {warnings.length} warning{warnings.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <ul className="max-h-96 divide-y divide-line overflow-y-auto">
        {all.map((e, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2 px-4 py-2 text-xs",
              e.severity === "WARNING" && "bg-warn/5",
            )}
          >
            <Chip tone={e.severity === "WARNING" ? "warn" : "neg"} className="mt-0.5">
              {SEVERITY_LABEL[e.severity]}
            </Chip>
            <span className="text-ink-2">
              <span className="font-mono text-ink-3">{e.code}</span> · {e.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
