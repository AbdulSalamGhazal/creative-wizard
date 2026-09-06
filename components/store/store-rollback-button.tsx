"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
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
import { useNavTransition } from "@/lib/nav-progress";
import { rollbackStoreBatch } from "@/app/actions/store-upload";

/**
 * Roll back a store upload batch — deletes only the orders it INSERTED (updates
 * it made are NOT undone, same caveat as the ads upsert). Gated behind an
 * acknowledgement checkbox, mirroring the ads rollback confirm.
 */
export function StoreRollbackButton({
  batchId,
  fileName,
  rowsInserted,
  updatedSince = 0,
}: {
  batchId: string;
  fileName: string;
  rowsInserted: number;
  /** Inserted orders a LATER upsert has revised since (0 = none). */
  updatedSince?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [isPending, startTransition] = useNavTransition();

  function doRollback() {
    startTransition(async () => {
      const res = await rollbackStoreBatch(batchId);
      if (!res.ok) {
        toast.error(res.error ?? "Rollback failed");
        return;
      }
      toast.success("Batch rolled back");
      setOpen(false);
      setAck(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-ink-3 hover:text-neg"
        onClick={() => setOpen(true)}
      >
        <Undo2 className="h-3.5 w-3.5" />
        Roll back
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (isPending) return;
          setOpen(o);
          if (!o) setAck(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Roll back this upload</DialogTitle>
            <DialogDescription>
              Removes the {rowsInserted} order{rowsInserted === 1 ? "" : "s"} that{" "}
              <span className="font-medium text-ink">{fileName}</span> inserted.
              Orders it updated are NOT reverted. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {/* A LATER upload has revised some of these orders. Rolling back
              deletes them outright, so those newer values go too — warn,
              don't block. */}
          {updatedSince > 0 && (
            <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-xs text-ink">
              <span className="font-medium">
                {updatedSince} of these orders were updated by a later upload
              </span>{" "}
              — rolling back deletes the newer values too.
            </div>
          )}
          <label className="flex items-start gap-2.5 rounded-md px-1 py-1 text-sm">
            <Checkbox
              checked={ack}
              onCheckedChange={(v) => setAck(v === true)}
              disabled={isPending}
            />
            <span className="text-ink-2">
              I understand this permanently deletes {rowsInserted} order
              {rowsInserted === 1 ? "" : "s"}.
            </span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doRollback}
              disabled={!ack || isPending}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Roll back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
