"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The one segmented control: a small row of mutually-exclusive options in a
 * bordered tray. Three copies of this markup had grown independently (the chart
 * MetricPicker, Reconciliation's mode toggle, Budget's currency toggle) and had
 * already drifted on tray colour and height.
 *
 * A RADIO GROUP (R-024, 2026-11-07): it is a single choice with no tab panel
 * behind it, and it used to announce itself as tabs — "use arrow keys" — while
 * the arrows did nothing. Now it behaves as one: ONE tab stop (the checked
 * option), ←/→ (and ↑/↓) move AND select, Home/End jump to the ends, disabled
 * options are skipped, and `aria-checked` says which one is live.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** `disabled` renders the option visibly unavailable; `title` says why. */
  options: ReadonlyArray<{
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const checked = options.findIndex((o) => o.value === value);
  // The tab stop: the checked option, else the first one that can be chosen.
  const tabStop = checked >= 0 && !options[checked]?.disabled ? checked : (enabled[0] ?? -1);

  const select = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    refs.current[i]?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const at = enabled.indexOf(i);
    if (at === -1 || enabled.length === 0) return;
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 text-[11px]",
        className,
      )}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-disabled={o.disabled || undefined}
          disabled={o.disabled}
          tabIndex={i === tabStop ? 0 : -1}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cn(
            // On touch the 28px option's hit box grows 8px up and down only, so
            // neighbours never overlap (R-036).
            "relative px-2.5 h-7 rounded-sm transition-colors whitespace-nowrap pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']",
            value === o.value ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
            // An unavailable option stays readable but visibly out of reach —
            // hiding it would leave the reader wondering where it went.
            o.disabled && "cursor-not-allowed opacity-40 hover:text-ink-3",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
