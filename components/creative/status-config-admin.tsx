"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setStatusWindow } from "@/app/actions/account";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { cn } from "@/lib/utils";

const PRESETS = [
  { hours: 24, label: "24 h", desc: "Spent on the most recent data day only" },
  { hours: 48, label: "48 h", desc: "Last 2 data days — tolerates a 1-day gap" },
  { hours: 72, label: "72 h", desc: "Last 3 data days — slowest to flip to Pause" },
];

/**
 * The status window's standing rule, for the column header's ⓘ (R-068: the
 * two-paragraph explainer card became this).
 */
export const STATUS_WINDOW_INFO =
  "A creative is Active on a platform when it has spent within this window of that platform's latest data day. Uploads are daily-grain, so the window rounds to whole days — 24 h is the latest day only. Each brand has its own window; a change applies on the next page load.";

/**
 * One brand's ACTIVE WINDOW, as a cell of the Brands table (R-068 — a single
 * per-brand number no longer takes a tab of its own): the three presets and a
 * custom hours field. The highlighted preset IS the current value (no
 * "{n}h window" pill beside it); a custom value shows in the field's
 * placeholder.
 */
export function StatusWindowControl({
  brandId,
  hours: current,
}: {
  brandId: string;
  hours: number;
}) {
  const [pending, startTransition] = useTransition();
  const [customRaw, setCustomRaw] = useState("");
  const customHours = customRaw ? Math.round(Number(customRaw)) : null;
  const isPreset = PRESETS.some((p) => p.hours === current);

  const save = (hours: number) => {
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      toast.error("Window must be 1–720 hours");
      return;
    }
    startTransition(async () => {
      const res = await safeAction(() => setStatusWindow({ id: brandId, hours }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't update");
        return;
      }
      // The action revalidated: this page arrived re-rendered in its response.
      toast.success("Active window updated");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((p) => {
        const active = current === p.hours && !customRaw;
        return (
          <button
            key={p.hours}
            type="button"
            disabled={pending}
            aria-pressed={active}
            onClick={() => {
              setCustomRaw("");
              if (current !== p.hours) save(p.hours);
            }}
            title={p.desc}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors whitespace-nowrap",
              active
                ? "border-brand bg-brand/10 text-brand font-medium"
                : "border-line bg-surface text-ink-2 hover:text-ink hover:border-line-2",
            )}
          >
            {p.label}
          </button>
        );
      })}
      <Input
        type="number"
        min={1}
        max={720}
        aria-label="Custom window in hours"
        placeholder={isPreset ? "Custom" : `${current}`}
        title={isPreset ? undefined : `Custom: ${current} h — the last ${Math.ceil(current / 24)} data day(s) on each platform`}
        value={customRaw}
        onChange={(e) => setCustomRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && customHours !== null) {
            save(customHours);
            setCustomRaw("");
          }
        }}
        className={cn(
          "h-7 w-20 text-xs",
          !isPreset && !customRaw && "border-brand placeholder:text-brand",
        )}
      />
      <span className="text-xs text-ink-3">h</span>
      {customHours !== null && customHours !== current && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            save(customHours);
            setCustomRaw("");
          }}
          className="h-7 text-xs"
        >
          Apply
        </Button>
      )}
    </div>
  );
}
