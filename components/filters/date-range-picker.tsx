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

  const initial: DateRange | undefined = useMemo(() => {
    if (from && to) {
      return { from: isoToLocalDate(from), to: isoToLocalDate(to) };
    }
    return undefined;
  }, [from, to]);
  const [pending, setPending] = useState<DateRange | undefined>(initial);

  const label = useMemo(() => presetLabel(from, to), [from, to]);
  const presetActive = activePresetKey(from, to);

  const onCalendarSelect = (range: DateRange | undefined) => {
    setPending(range);
    // Apply once a full range is selected; keep the picker open after the
    // first click so the user can choose the second date.
    if (range?.from && range.to) {
      onChange(localDateToIso(range.from), localDateToIso(range.to));
      setOpen(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPending(initial); // re-seed from current range on open
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
