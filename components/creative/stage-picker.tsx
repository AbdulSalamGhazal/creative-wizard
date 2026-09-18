"use client";

import { cn } from "@/lib/utils";
import { FUNNEL_STAGES, STAGE_SHORT, sortStages } from "@/lib/funnel-stages";

/**
 * Manual STAGE picker — one toggle chip per funnel stage, multi-select, shared
 * by the detail header (inside its draft/Save flow) and the create form.
 *
 * An empty set is valid and normal ("unassigned"), so there is no clear button:
 * un-toggling everything IS the cleared state. The value is kept in funnel
 * order, so a set never depends on click order.
 */
export function StagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (stage: string) =>
    onChange(
      value.includes(stage)
        ? value.filter((s) => s !== stage)
        : sortStages([...value, stage]),
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FUNNEL_STAGES.map((stage) => {
        const on = value.includes(stage);
        return (
          <button
            key={stage}
            type="button"
            onClick={() => toggle(stage)}
            disabled={disabled}
            aria-pressed={on}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors disabled:opacity-60",
              on
                ? "border-brand bg-[var(--brand-soft)] text-ink"
                : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
            )}
          >
            {stage}
            <span className="text-[10px] text-ink-3">{STAGE_SHORT[stage]}</span>
          </button>
        );
      })}
    </div>
  );
}
