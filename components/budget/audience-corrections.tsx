"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformDot } from "@/components/ui/platform-dot";
import { int } from "@/lib/format";
import { platformLabel } from "@/components/budget/budget-shared";
import { STAGE_SHORT } from "@/lib/audience";
import {
  deleteAudienceSnapshot,
  updateAudienceSnapshot,
} from "@/app/actions/audience";
import type { AudienceCorrectionRow } from "@/db/queries/audience";

const digits = (raw: string) => raw.replace(/[^0-9]/g, "");

/**
 * Recent measurements, newest first — the place a mistyped number gets fixed.
 *
 * Bounded at 100 by the query: this is a correction desk, not a history
 * browser (the trend chart and the comparison table are where history is
 * read). Everyone can look; editing and deleting need `audience.manage`.
 */
export function AudienceCorrections({
  open,
  onOpenChange,
  rows,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: AudienceCorrectionRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (row: AudienceCorrectionRow) => {
    setEditingId(row.id);
    setDraft(String(row.size));
  };

  const save = (id: string) => {
    startTransition(async () => {
      const res = await updateAudienceSnapshot({ id, size: Number(draft || "0") });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save that correction.");
        return;
      }
      toast.success("Corrected.");
      setEditingId(null);
      router.refresh();
    });
  };

  const remove = (row: AudienceCorrectionRow) => {
    startTransition(async () => {
      const res = await deleteAudienceSnapshot({ id: row.id });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete that measurement.");
        return;
      }
      toast.success(`Deleted the ${row.date} measurement.`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recent measurements</DialogTitle>
          <DialogDescription>
            The last {rows.length} measurements, newest first.{" "}
            {canManage
              ? "Fix a typo in place, or delete a measurement recorded against the wrong date."
              : "Recording and correcting needs the audience permission."}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="num w-24 shrink-0 text-xs text-ink-2">{row.date}</span>
                <span className="inline-flex min-w-[9rem] items-center gap-1.5 text-xs text-ink">
                  <PlatformDot platform={row.platform} size="sm" />
                  {platformLabel(row.platform)}
                  <span className="text-ink-3">{STAGE_SHORT[row.stage]}</span>
                </span>
                {editingId === row.id ? (
                  <span className="flex items-center gap-1">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(digits(e.target.value))}
                      inputMode="numeric"
                      className="h-7 w-28 text-right num"
                      aria-label="Corrected size"
                    />
                    <button
                      type="button"
                      onClick={() => save(row.id)}
                      disabled={isPending || draft === ""}
                      className="text-pos disabled:opacity-50"
                      aria-label="Save correction"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-ink-3"
                      aria-label="Cancel correction"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : (
                  <span className="num text-xs text-ink">{int(row.size)}</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {row.recordedBy && (
                    <span className="text-[11px] text-ink-3">{row.recordedBy}</span>
                  )}
                  {canManage && editingId !== row.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="text-ink-3 hover:text-ink"
                        aria-label={`Edit the ${row.date} measurement`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        disabled={isPending}
                        className="text-ink-3 hover:text-warn disabled:opacity-50"
                        aria-label={`Delete the ${row.date} measurement`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
