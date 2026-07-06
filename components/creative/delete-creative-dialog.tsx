"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteCreative } from "@/app/actions/creative";
import { int } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { useCan } from "@/components/auth/permissions-context";
import type { CreativeDeletionSummary } from "@/db/queries/creatives";

export function DeleteCreativeDialog({
  creativeId,
  creativeName,
  summary,
}: {
  creativeId: string;
  creativeName: string;
  summary: CreativeDeletionSummary;
}) {
  const router = useRouter();
  const canDelete = useCan("creative.delete");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasRecords = summary.records > 0;

  const onConfirm = () => {
    startTransition(async () => {
      const res = await deleteCreative(creativeId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete the creative");
        return;
      }
      toast.success(
        res.recordsDeleted && res.recordsDeleted > 0
          ? `Deleted “${creativeName}” and ${int(res.recordsDeleted)} record${
              res.recordsDeleted === 1 ? "" : "s"
            }`
          : `Deleted “${creativeName}”`,
      );
      setOpen(false);
      router.push("/creatives");
      router.refresh();
    });
  };

  if (!canDelete) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return; // don't allow closing mid-delete
        setOpen(next);
        if (!next) setAcknowledged(false);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-ink-3 hover:text-neg hover:bg-neg/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-neg/10 text-neg">
              <AlertTriangle className="w-4 h-4" />
            </span>
            Delete this creative?
          </DialogTitle>
          <DialogDescription>
            Permanently remove{" "}
            <span className="font-medium text-ink">{creativeName}</span> and
            everything attached to it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* What gets deleted */}
          <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">
                Attached performance records
              </span>
              <span className="font-display text-2xl num text-ink leading-none">
                {int(summary.records)}
              </span>
            </div>

            {hasRecords && (
              <>
                <div className="h-px bg-line" />
                <div className="space-y-1">
                  {summary.platforms.map((p) => (
                    <div
                      key={p.platform}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="text-ink-3">
                        {PLATFORM_LABEL[p.platform]}
                      </span>
                      <span className="text-ink-2 num">{int(p.records)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px] text-ink-3 pt-0.5">
                  <span>
                    {int(summary.campaigns)} campaign
                    {summary.campaigns === 1 ? "" : "s"}
                  </span>
                  {summary.firstDate && summary.lastDate && (
                    <span className="num">
                      {summary.firstDate} → {summary.lastDate}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* The reassurance the user asked for */}
          <p className="text-xs text-ink-2 leading-relaxed">
            {hasRecords ? (
              <>
                These {int(summary.records)} records belong{" "}
                <span className="font-medium text-ink">only</span> to this
                creative — they are not shared with any other creative. Deleting
                it removes them too, and{" "}
                <span className="font-medium text-ink">
                  nothing will stay tied to this creative afterwards
                </span>
                . No other creative is affected.
              </>
            ) : (
              <>
                This creative has no performance records. Only the creative and
                its tags will be removed — no other creative is affected.
              </>
            )}
          </p>

          {/* Acknowledgement guard */}
          <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-line bg-surface px-3 py-2.5">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              disabled={isPending}
              className="mt-0.5"
            />
            <span className="text-xs text-ink-2">
              I understand this permanently deletes{" "}
              <span className="text-ink">{creativeName}</span>
              {hasRecords
                ? ` and its ${int(summary.records)} performance record${
                    summary.records === 1 ? "" : "s"
                  }.`
                : "."}
            </span>
          </label>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!acknowledged || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                Delete permanently
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
