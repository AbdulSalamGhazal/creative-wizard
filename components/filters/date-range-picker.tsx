"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  activePresetKey,
  DATE_PRESETS,
  encodePreferredRange,
  isoToLocalDate,
  localDateToIso,
  presetLabel,
  resolveDefaultRange,
  todayIso,
  type DateRangeValue,
} from "@/lib/date-presets";
import { rememberRange, useRangeCatchUp } from "@/lib/pref-sync";

/**
 * Reusable date-range control: the full preset list on the left, a live
 * two-month calendar on the right. Picking a preset or completing a range on
 * the calendar applies immediately — no extra "apply" step.
 *
 * Presentational — the parent owns where the range goes (URL params, state, …)
 * via `onChange`. Passing `null, null` means Lifetime / all-time. Conversions
 * go through lib/date-presets so the picked day never shifts across the UTC
 * boundary.
 */
const WIDE_QUERY = "(min-width: 640px)";
function subscribeWide(cb: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readWide = (): boolean => window.matchMedia(WIDE_QUERY).matches;

export function DateRangePicker({
  from,
  to,
  onChange,
  remember = false,
  fallback,
  fullWidth = false,
  hidePresets,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  /** When true, a pick is saved as this user's default (DB, server-side). */
  remember?: boolean;
  /**
   * Range to show as the label / calendar seed when no explicit range is set —
   * the user's saved default, resolved server-side and passed in. Highlight
   * stays driven by the raw `from`/`to`.
   */
  fallback?: DateRangeValue;
  /** Full-width stacked trigger for the mobile filter Sheet. */
  fullWidth?: boolean;
  /**
   * Preset keys to leave out. Budget's Pacing hides "Lifetime" because an
   * unbounded range has no plan to compare against — offering a control that
   * silently does nothing is worse than not offering it.
   */
  hidePresets?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  // Two months side by side from `sm` up; one on a phone (W3, 375px).
  const wide = useSyncExternalStore(subscribeWide, readWide, () => true);

  // Persist the pick as the user's default — WRITE-THROUGH (W2-1, 2026-10):
  // the parent's URL write is the one render; the saved default is for the
  // next bare visit, which renders fresh. (This used to await the action, which
  // revalidated, and then `router.refresh()` — three renders per pick.)
  const persist = (value: string | null) => {
    if (!remember || !value) return;
    rememberRange(value);
  };
  // A bare URL shows the saved default. If Back/Forward restored this page
  // from the router cache after this tab picked a newer one, re-read it once.
  useRangeCatchUp(remember && !from && !to ? fallback : undefined);

  // The effective range: the explicit one, else the passed-in fallback (the
  // saved default), else last 7 days. Drives the label, highlighted preset,
  // and calendar seed.
  const eff = useMemo(
    () => (from && to ? { from, to } : (fallback ?? resolveDefaultRange(null, null))),
    [from, to, fallback],
  );
  const initial: DateRange | undefined = useMemo(
    () => ({ from: isoToLocalDate(eff.from), to: isoToLocalDate(eff.to) }),
    [eff],
  );
  const [pending, setPending] = useState<DateRange | undefined>(initial);
  // First click of an in-progress selection. While set, the next click
  // completes the range. We drive selection from the clicked day ourselves so
  // a fresh click always starts a new range instead of extending the seeded one.
  const [anchor, setAnchor] = useState<Date | null>(null);

  const label = useMemo(() => presetLabel(eff.from, eff.to), [eff]);
  const presetActive = activePresetKey(eff.from, eff.to);

  // `triggerDate` is the day actually clicked — we ignore react-day-picker's
  // computed range and build a deterministic two-click flow from it.
  const onCalendarSelect = (
    _range: DateRange | undefined,
    triggerDate: Date,
  ) => {
    if (anchor === null) {
      // First click: start a fresh range at the clicked day.
      setAnchor(triggerDate);
      setPending({ from: triggerDate, to: undefined });
      return;
    }
    // Second click: complete the range (order the two endpoints) and apply.
    const fromD = anchor <= triggerDate ? anchor : triggerDate;
    const toD = anchor <= triggerDate ? triggerDate : anchor;
    setPending({ from: fromD, to: toD });
    setAnchor(null);
    const fromIso = localDateToIso(fromD);
    const toIso = localDateToIso(toD);
    persist(encodePreferredRange(null, fromIso, toIso));
    onChange(fromIso, toIso);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Re-seed from the current range and reset the in-progress anchor.
          setPending(initial);
          setAnchor(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            from || to
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
            fullWidth && "w-full justify-between",
          )}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <CalendarDays className="w-3.5 h-3.5 shrink-0" />
            <span className="text-ink-3 shrink-0">Date</span>
            <span className="text-ink truncate">{label}</span>
          </span>
          <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
        </button>
      </PopoverTrigger>
      {/* On a phone the presets + two months were ~434px in a 375px frame and
          Saturday was cut off (W3): below `sm` the presets stack over ONE
          month, and the popover never outgrows the viewport. */}
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="p-0 w-auto max-w-[calc(100vw-1rem)]"
      >
        <div className="flex flex-col sm:flex-row">
          {/* Quick ranges */}
          <div className="w-full sm:w-40 p-1 border-b sm:border-b-0 sm:border-r border-line shrink-0">
            <div className="px-2 py-1.5 text-label text-ink-3">
              Quick ranges
            </div>
            <div className="grid grid-cols-2 gap-0.5 sm:block sm:space-y-0.5">
              {DATE_PRESETS.filter((p) => !hidePresets?.includes(p.key)).map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    persist(p.key);
                    const res = p.range(todayIso());
                    if (res) onChange(res.from, res.to);
                    else onChange(null, null);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-surface-2 hover:text-ink",
                    presetActive === p.key ? "text-ink bg-surface-2" : "text-ink-2",
                  )}
                >
                  <span className="flex-1 text-left">{p.label}</span>
                  {presetActive === p.key && (
                    <Check className="w-3.5 h-3.5 text-brand" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar — selecting a full range applies it directly */}
          <div className="p-3">
            <Calendar
              mode="range"
              numberOfMonths={wide ? 2 : 1}
              defaultMonth={pending?.from ?? initial?.from ?? new Date()}
              selected={pending}
              onSelect={onCalendarSelect}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
