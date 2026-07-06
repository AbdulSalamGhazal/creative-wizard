"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rollbackBatch } from "@/app/actions/rollback";

interface Props {
  batchId: string;
  fileName: string;
  rowCount: number;
}

export function RollbackButton({ batchId, fileName, rowCount }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const run = () => {
    if (!acknowledged) return;
    setError(null);
    startTransition(async () => {
      const res = await rollbackBatch(batchId);
      if (!res.ok) {
        setError(res.error ?? "Rollback failed.");
        toast.error(res.error ?? "Rollback failed");
        return;
      }
      setOpen(false);
      toast.success(`Batch rolled back · ${rowCount} rows removed`);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return; // don't allow closing mid-rollback
        setOpen(o);
        if (!o) {
          setError(null);
          setAcknowledged(false);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        className="text-ink-3 hover:text-warn"
        title="Roll back this batch"
      >
        <RotateCcw className="w-3 h-3" />
        Rollback
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roll back this upload?</DialogTitle>
          <DialogDescription>
            This deletes all {rowCount} performance records imported from{" "}
            <code className="font-mono text-ink-2">{fileName}</code>. Blended
            metrics across the dashboard will update immediately. The batch
            row stays for audit; its status flips to <em>rolled_back</em>.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
            {error}
          </div>
        )}

        {/* Acknowledgement guard — same strength as the delete dialogs. */}
        <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-line bg-surface px-3 py-2.5">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            disabled={isPending}
            className="mt-0.5"
          />
          <span className="text-xs text-ink-2">
            I understand this permanently removes {rowCount} performance record
            {rowCount === 1 ? "" : "s"}.
          </span>
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={run}
            disabled={!acknowledged || isPending}
          >
            {isPending ? "Rolling back…" : "Roll back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
