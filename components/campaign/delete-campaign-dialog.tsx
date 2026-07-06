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
import { deleteCampaign } from "@/app/actions/campaign";
import { int } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { useCan } from "@/components/auth/permissions-context";
import type { CampaignDeletionSummary } from "@/db/queries/campaign";

/**
 * Confirm-and-delete a whole campaign. Mirrors DeleteCreativeDialog, with one
 * key difference spelled out for the user: deleting a campaign removes its
 * performance records but KEEPS the creatives that ran in it (they may still
 * hold data in other campaigns). An acknowledgement checkbox gates the button.
 */
export function DeleteCampaignDialog({
  campaignId,
  campaignName,
  summary,
}: {
  campaignId: string;
  campaignName: string;
  summary: CampaignDeletionSummary;
}) {
  const router = useRouter();
  const canDelete = useCan("campaign.delete");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasRecords = summary.records > 0;

  const onConfirm = () => {
    startTransition(async () => {
      const res = await deleteCampaign(campaignId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete the campaign");
        return;
      }
      toast.success(
        res.recordsDeleted && res.recordsDeleted > 0
          ? `Deleted “${campaignName}” and ${int(res.recordsDeleted)} record${
              res.recordsDeleted === 1 ? "" : "s"
            }`
          : `Deleted “${campaignName}”`,
      );
      setOpen(false);
      router.push("/campaigns");
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
            Delete this campaign?
          </DialogTitle>
          <DialogDescription>
            Permanently remove{" "}
            <span className="font-medium text-ink">{campaignName}</span> and all
            of its performance records. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* What gets deleted */}
          <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">Performance records</span>
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
                    {int(summary.creatives)} creative
                    {summary.creatives === 1 ? "" : "s"} (kept)
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

          {/* The important consequence: creatives survive. */}
          <p className="text-xs text-ink-2 leading-relaxed">
            {hasRecords ? (
              <>
                This removes the {int(summary.records)} record
                {summary.records === 1 ? "" : "s"} tied to this campaign. The{" "}
                <span className="font-medium text-ink">
                  {int(summary.creatives)} creative
                  {summary.creatives === 1 ? "" : "s"} that ran here are kept
                </span>{" "}
                — only their data for this campaign is deleted; anything they ran
                in other campaigns is untouched.
              </>
            ) : (
              <>
                This campaign has no performance records. Only the campaign
                registration will be removed — no creative is affected.
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
              <span className="text-ink">{campaignName}</span>
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
