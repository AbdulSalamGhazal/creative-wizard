"use client";

import { useMemo, useState } from "react";
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
  isoToLocalDate,
  localDateToIso,
  presetLabel,
  resolveDefaultRange,
  todayIso,
} from "@/lib/date-presets";

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
export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // The effective range: the explicit one, or the default (last 7 days) when
  // nothing is set. Drives the label, the highlighted preset, and the calendar
  // seed, so an unset picker still reads "Last 7 days".
  const eff = useMemo(() => resolveDefaultRange(from, to), [from, to]);
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
    onChange(localDateToIso(fromD), localDateToIso(toD));
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
          )}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          <span className="text-ink-3">Date</span>
          <span className="text-ink">{label}</span>
          <ChevronDown className="w-3 h-3 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-auto">
        <div className="flex">
          {/* Quick ranges */}
          <div className="w-40 p-1 border-r border-line shrink-0">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3">
              Quick ranges
            </div>
            <div className="space-y-0.5">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
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
              numberOfMonths={2}
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
