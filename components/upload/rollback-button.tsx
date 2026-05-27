"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await rollbackBatch(batchId);
      if (!res.ok) {
        setError(res.error ?? "Rollback failed.");
        return;
      }
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
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
          <div className="text-xs text-neg">{error}</div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={run} disabled={isPending}>
            {isPending ? "Rolling back…" : "Roll back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
