"use client";

import { cn } from "@/lib/utils";
import { FUNNEL_STAGES, NA_STAGE, STAGE_SHORT, sortStages } from "@/lib/funnel-stages";

/**
 * Manual STAGE picker — one toggle chip per funnel stage, multi-select, shared
 * by the detail header (inside its draft/Save flow) and the create form.
 *
 * An empty set is valid and normal ("unassigned"), so there is no clear button:
 * un-toggling everything IS the cleared state. The value is kept in funnel
 * order, so a set never depends on click order.
 *
 * The fourth chip, N/A, is a DIFFERENT statement — "declared: no clear stage",
 * not "not yet declared" — so it sits apart behind a divider, in a muted tone,
 * and is EXCLUSIVE: picking it clears the funnel stages and picking any stage
 * clears it. `stagesSchema` rejects the combination anyway; this is the
 * normalization that means nobody ever sees the error.
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
  /** Toggling a funnel stage drops N/A — the two can't both be true. */
  const toggle = (stage: string) =>
    onChange(
      value.includes(stage)
        ? value.filter((s) => s !== stage)
        : sortStages([...value.filter((s) => s !== NA_STAGE), stage]),
    );

  const naOn = value.includes(NA_STAGE);
  /** N/A replaces the whole set; toggling it off leaves unassigned. */
  const toggleNa = () => onChange(naOn ? [] : [NA_STAGE]);

  const chip = (on: boolean, muted = false) =>
    cn(
      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors disabled:opacity-60",
      on
        ? muted
          // Pressed, but NEUTRAL — the brand border belongs to the funnel.
          // `line-2` alone was a 47-point step from the unpressed border on
          // Midnight and barely moved the fill on the light themes; ink-3
          // reads as pressed without borrowing the funnel's colour.
          ? "border-ink-3 bg-surface-3 text-ink"
          : "border-brand bg-[var(--brand-soft)] text-ink"
        : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
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
            className={chip(on)}
          >
            {stage}
            <span className="text-[10px] text-ink-3">{STAGE_SHORT[stage]}</span>
          </button>
        );
      })}

      {/* Apart from the funnel: a divider, then the muted N/A chip. */}
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <button
        type="button"
        onClick={toggleNa}
        disabled={disabled}
        aria-pressed={naOn}
        title="Declared: this creative has no clear funnel stage (different from leaving it unassigned)"
        className={chip(naOn, true)}
      >
        {NA_STAGE}
      </button>
    </div>
  );
}
