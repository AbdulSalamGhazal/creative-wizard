"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { addAdSets } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useCan } from "@/components/auth/permissions-context";
import { shallowParams } from "@/lib/shallow-url";
import type { AdNetwork } from "@/lib/campaign";
import {
  AdSetRows,
  adSetDrafts,
  adSetRowsReady,
  newAdSetRow,
  type AdSetRowDraft,
} from "@/components/campaign/ad-set-rows";

/**
 * "Add ad set" on a campaign's page (2026-11): register more ad sets under
 * it. The same rows as the New campaign form. `prefill` is the upload
 * report's way in — an ad set a file named that this campaign doesn't have
 * yet (E062 → `?addAdSet=<name>`): the dialog opens on it, ready for its
 * objective.
 */
export function AddAdSetDialog({
  parentId,
  campaignName,
  network,
  prefill = [],
}: {
  parentId: string;
  campaignName: string;
  network: AdNetwork;
  /** Ad-set names to start with, and to open on (from `?addAdSet=`). */
  prefill?: string[];
}) {
  const canCreate = useCan("campaign.create");
  const start0 = (): AdSetRowDraft[] =>
    prefill.length > 0 ? prefill.map((n) => newAdSetRow(network, n)) : [newAdSetRow(network)];
  const [open, setOpen] = useState(prefill.length > 0);
  const [rows, setRows] = useState<AdSetRowDraft[]>(start0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adSetErrors, setAdSetErrors] = useState<Record<number, string>>({});

  /** The prefill is a one-shot: once the dialog is dealt with, it leaves the URL. */
  const dropPrefill = () => {
    if (prefill.length === 0) return;
    shallowParams((p) => p.delete("addAdSet"), "replace");
  };

  const onOpenChange = (next: boolean) => {
    if (pending) return; // don't allow closing mid-save
    if (next) {
      setRows([newAdSetRow(network)]);
      setError(null);
      setAdSetErrors({});
    } else {
      dropPrefill();
    }
    setOpen(next);
  };

  const ready = adSetRowsReady(rows);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setAdSetErrors({});
    start(async () => {
      const res = await safeAction(() => addAdSets({ parentId, adSets: adSetDrafts(rows) }));
      if (res.ok) {
        // ONE render (W2-1): the action revalidated this page — the new ad
        // sets are already in the table behind the dialog.
        toast.success(rows.length === 1 ? "Ad set added" : `${rows.length} ad sets added`);
        dropPrefill();
        setOpen(false);
        return;
      }
      if ("adSetErrors" in res && res.adSetErrors) setAdSetErrors(res.adSetErrors);
      toastActionFailure(res, "Couldn't add the ad set", { inline: setError });
    });
  };

  if (!canCreate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-3.5 h-3.5" /> Add ad set
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add ad set</DialogTitle>
          <DialogDescription>
            <span dir="auto">To {campaignName}.</span> Name it exactly as your ad-platform export
            does, so uploads line up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* `pb-2`: the sticky DialogFooter rides 8px up over whatever sits
              above it inside a form — enough to clip the "Add ad set" row
              button's lower edge. */}
          <div className="space-y-4 pb-2">
            <AdSetRows
              network={network}
              campaignName={campaignName}
              rows={rows}
              onChange={(next) => {
                setRows(next);
                setAdSetErrors({});
              }}
              errors={adSetErrors}
              disabled={pending}
            />

            <FormError>{error}</FormError>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ready}>
              {pending ? "Adding…" : rows.length > 1 ? `Add ${rows.length} ad sets` : "Add ad set"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
