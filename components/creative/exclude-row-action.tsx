"use client";

import { useState, useTransition } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { excludeRecord, includeRecord } from "@/app/actions/exclusion";
import { cn } from "@/lib/utils";

interface Props {
  recordId: number;
  excluded: boolean;
  /** Optional context shown in the dialog header. */
  context?: string;
}

const REASON_MAX = 200;

export function ExcludeRowAction({ recordId, excluded, context }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitExclude = () => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError("A reason is required.");
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setError(`Reason must be ${REASON_MAX} characters or fewer.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await excludeRecord(recordId, trimmed);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        toast.error(res.error ?? "Could not exclude record");
        return;
      }
      setOpen(false);
      setReason("");
      toast.success("Record excluded from totals");
    });
  };

  const submitInclude = () => {
    startTransition(async () => {
      const res = await includeRecord(recordId);
      if (!res.ok) {
        toast.error(res.error ?? "Could not re-include record");
        return;
      }
      toast.success("Record back in totals");
    });
  };

  if (excluded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={submitInclude}
        disabled={isPending}
        className="text-ink-3 hover:text-ink"
        title="Re-include in totals"
      >
        <RotateCcw className="w-3 h-3" />
        Re-include
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setReason("");
          setError(null);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        className="text-ink-3 hover:text-warn"
        title="Exclude from totals"
      >
        <Ban className="w-3 h-3" />
        Exclude
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exclude record from totals</DialogTitle>
          <DialogDescription>
            This row will be hidden from every blended metric across the dashboard
            until it&apos;s re-included. {context && <span>{context}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="exclude-reason">Reason</Label>
          <Textarea
            id="exclude-reason"
            placeholder="e.g. Platform double-counted impressions on this day."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX + 32}
            className="min-h-[88px]"
            autoFocus
          />
          <div className="flex items-center justify-between text-[11px]">
            <span className={cn(error ? "text-neg" : "text-ink-3")}>
              {error ?? `Required, ${REASON_MAX} chars max.`}
            </span>
            <span
              className={cn(
                "num",
                reason.length > REASON_MAX ? "text-neg" : "text-ink-3",
              )}
            >
              {reason.length} / {REASON_MAX}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submitExclude}
            disabled={isPending || reason.trim().length === 0}
          >
            {isPending ? "Excluding…" : "Exclude record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
