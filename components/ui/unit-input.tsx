"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Phone + keyboard flow for a form full of numeric fields (the Plan editor's
 * cascade, the Audience record grid).
 *
 * One ref goes on the form container; every field spreads `fieldProps`. Enter
 * walks to the next `[data-budget-field]` in DOM order — which both callers
 * keep as the visual order — skipping disabled fields; Escape blurs; focus
 * selects, so a correction overwrites instead of appending to what's there.
 */
export function useFieldFlow(inputMode: "decimal" | "numeric" = "decimal") {
  const formRef = useRef<HTMLDivElement>(null);
  const fieldProps = {
    inputMode,
    "data-budget-field": true,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const fields = Array.from(
        formRef.current?.querySelectorAll<HTMLInputElement>("[data-budget-field]") ?? [],
      ).filter((el) => !el.disabled);
      const next = fields[fields.indexOf(e.currentTarget) + 1];
      if (next) {
        next.focus();
        next.select();
      } else {
        e.currentTarget.blur();
      }
    },
  };
  return { formRef, fieldProps };
}

/**
 * A numeric field with its unit INSIDE the box — the Budget module's house
 * money input. Shared by the Budget Plan cascade, its CSV upload dialog and the
 * Price Structure editors, so none of them drift on padding or the unit's weight.
 */
export function UnitInput({
  unit,
  title,
  wrapperClassName,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string; wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)} title={title}>
      <Input
        {...props}
        className={cn("peer text-right tabular-nums", unit.length > 1 ? "pr-11" : "pl-2 pr-6", className)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-3 peer-disabled:opacity-50"
      >
        {unit}
      </span>
    </div>
  );
}
