"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { intCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGES,
  STAGE_SHORT,
  asOfLabel,
  audienceKey,
  isStale,
  stalenessDays,
  type FunnelStage,
} from "@/lib/audience";
import { useFieldFlow } from "@/components/budget/budget-shared";
import { recordAudienceSnapshots } from "@/app/actions/audience";
import type { AudienceSnapshotRow } from "@/db/queries/audience";

const digits = (raw: string) => raw.replace(/[^0-9]/g, "");

/**
 * "Record sizes" — one date's measurements, typed into a stage × platform grid.
 *
 * Every cell shows the latest known size MUTED as its placeholder with the
 * measurement's age beside it, so you can see what you're replacing. A cell you
 * don't type in writes nothing at all: that is the whole point of the sparse
 * model — one stage measured today is a complete, valid record, and the
 * untouched pairs keep carrying their last value forward rather than gaining a
 * fabricated one.
 */
export function AudienceRecordDialog({
  open,
  onOpenChange,
  latest,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  latest: AudienceSnapshotRow[];
  today: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(today);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const { formRef, fieldProps } = useFieldFlow("numeric");

  const latestOf = (platform: string, stage: FunnelStage) =>
    latest.find((r) => r.platform === platform && r.stage === stage) ?? null;

  const typed = Object.entries(sizes).filter(([, v]) => v.trim() !== "");
  const futureDate = date > today;

  const reset = () => {
    setSizes({});
    setDate(today);
  };

  const submit = () => {
    const entries = typed.map(([key, value]) => {
      const [platform, stage] = key.split("|");
      return { platform, stage, size: Number(value) };
    });
    startTransition(async () => {
      const res = await recordAudienceSnapshots({ date, entries });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't record those sizes.");
        return;
      }
      toast.success(
        `Recorded ${res.recorded} ${res.recorded === 1 ? "size" : "sizes"} for ${date}.`,
      );
      onOpenChange(false);
      reset();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record sizes</DialogTitle>
          <DialogDescription>
            Type only what you measured — every other cell is left exactly as it
            is. Greyed numbers are the last known size.
          </DialogDescription>
        </DialogHeader>

        <div ref={formRef} className="space-y-3">
          <label className="block space-y-1">
            <span className="block text-label text-ink-3">Measured on</span>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-44 num"
              aria-label="Measurement date"
            />
          </label>

          {/* Stage rows × platform columns. On a phone the grid scrolls
              sideways rather than reflowing — the matrix shape IS the mental
              model, and a stacked version loses it. */}
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[34rem] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface py-1 pr-3 text-left text-label text-ink-3">
                    Stage
                  </th>
                  {ALL_PLATFORMS.map((p) => (
                    <th key={p} className="px-1.5 py-1 text-left text-label text-ink-3">
                      <span className="inline-flex items-center gap-1.5">
                        <PlatformDot platform={p} size="sm" />
                        {PLATFORM_LABEL[p]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FUNNEL_STAGES.map((stage) => (
                  <tr key={stage}>
                    <th className="sticky left-0 z-10 bg-surface py-1.5 pr-3 text-left text-sm font-medium text-ink">
                      {stage}{" "}
                      <span className="text-[11px] font-normal text-ink-3">
                        {STAGE_SHORT[stage]}
                      </span>
                    </th>
                    {ALL_PLATFORMS.map((platform) => {
                      const key = audienceKey(platform, stage);
                      const known = latestOf(platform, stage);
                      const age = known ? stalenessDays(known.date, today) : null;
                      return (
                        <td key={platform} className="px-1.5 py-1.5 align-top">
                          <Input
                            {...fieldProps}
                            value={sizes[key] ?? ""}
                            onChange={(e) =>
                              setSizes((s) => ({ ...s, [key]: digits(e.target.value) }))
                            }
                            placeholder={known ? String(known.size) : "—"}
                            className="h-8 w-full text-right num"
                            aria-label={`${PLATFORM_LABEL[platform]} ${stage} audience size`}
                          />
                          <span
                            className={cn(
                              "mt-0.5 block text-[10px]",
                              isStale(age) ? "text-warn" : "text-ink-3",
                            )}
                            title={known ? asOfLabel(known.date, age) : "Never measured"}
                          >
                            {known ? `${intCompact(known.size)} · ${age}d` : "—"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {futureDate && (
            <p className="text-[11px] text-warn">
              An audience can&rsquo;t be measured in the future.
            </p>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-[11px] text-ink-3">
            {typed.length === 0
              ? "Nothing typed yet."
              : `${typed.length} ${typed.length === 1 ? "size" : "sizes"} will be recorded.`}
          </span>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={typed.length === 0 || futureDate || isPending}
          >
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
