"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/lib/brand-nav";
import { Loader2, Trash2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { ToneDialogTitle } from "@/components/ui/dialog-tone";
import { deleteParentCampaign } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { actionSettled } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import { int } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { useCan } from "@/components/auth/permissions-context";
import { TypeToConfirm, confirmMatches } from "@/components/ui/type-to-confirm";
import type { ParentCampaignDeletionSummary } from "@/db/queries/parent-campaign";
import { useNavTransition } from "@/lib/nav-progress";

const plural = (n: number, word: string) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * Confirm-and-delete a whole CAMPAIGN (2026-11): every ad set under it and
 * every performance record of those ad sets. Mirrors the ad set's delete
 * dialog — the same summary box, the same two guards (an acknowledgement, then
 * typing the name) — with the ad-set count stated first, because that is what
 * makes this bigger than deleting one ad set. The creatives are kept.
 */
export function DeleteParentCampaignDialog({
  parentId,
  campaignName,
  summary,
}: {
  parentId: string;
  campaignName: string;
  summary: ParentCampaignDeletionSummary;
}) {
  const router = useRouter();
  const canDelete = useCan("campaign.delete");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // The last step of an unrecoverable delete: type the name (D23).
  const [typed, setTyped] = useState("");
  const confirmed = acknowledged && confirmMatches(typed, campaignName);
  const [isPending, startTransition] = useTransition();
  // Navigations show the progress bar (W3-6).
  const [, startNav] = useNavTransition();

  const hasRecords = summary.records > 0;

  const onConfirm = () => {
    startTransition(async () => {
      const res = await safeAction(() => deleteParentCampaign(parentId));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't delete the campaign");
        return;
      }
      const sets = res.adSetsDeleted ?? 0;
      const records = res.recordsDeleted ?? 0;
      toast.success(
        `Deleted “${campaignName}”` +
          (sets > 0 ? ` — ${plural(sets, "ad set")}` : "") +
          (records > 0 ? `, ${plural(records, "record")}` : ""),
      );
      setOpen(false);
      // ONE render: the action doesn't revalidate (the page it would re-render
      // no longer exists); the navigation renders the list fresh (W2-1) —
      // once the router is done with the action.
      await actionSettled();
      startNav(() => router.push("/campaigns"));
    });
  };

  if (!canDelete) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return; // don't allow closing mid-delete
        setOpen(next);
        if (!next) {
          setAcknowledged(false);
          setTyped("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-ink-3 hover:text-neg hover:bg-neg/10">
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <ToneDialogTitle tone="destructive">Delete this campaign?</ToneDialogTitle>
          <DialogDescription>
            Permanently remove{" "}
            <span className="font-medium text-ink" dir="auto">
              {campaignName}
            </span>
            , its ad sets and all of their performance records. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {/* `pb-2`: the sticky DialogFooter rides 8px up over what sits above
            it — here, the type-to-confirm input's lower edge. */}
        <div className="space-y-3 pb-2">
          {/* What gets deleted */}
          <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">Ad sets</span>
              <span className="font-display text-2xl tabular-nums text-ink leading-none">
                {int(summary.adSets)}
              </span>
            </div>
            <div className="h-px bg-line" />
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">Performance records</span>
              <span className="font-display text-2xl tabular-nums text-ink leading-none">
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
                      <span className="text-ink-2">{PLATFORM_LABEL[p.platform]}</span>
                      <span className="text-ink-2 tabular-nums">{int(p.records)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px] text-ink-2 pt-0.5">
                  <span>{plural(summary.creatives, "creative")} (kept)</span>
                  {summary.firstDate && summary.lastDate && (
                    <span className="tabular-nums">
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
                This removes the {plural(summary.adSets, "ad set")} and the{" "}
                {plural(summary.records, "record")} tied to them. The{" "}
                <span className="font-medium text-ink">
                  {plural(summary.creatives, "creative")} that ran here are kept
                </span>{" "}
                — only their data for this campaign is deleted; anything they ran in other
                campaigns is untouched.
              </>
            ) : summary.adSets > 0 ? (
              <>
                This campaign has no performance records. Its {plural(summary.adSets, "ad set")}{" "}
                and its registration will be removed — no creative is affected.
              </>
            ) : (
              <>
                This campaign has no ad sets. Only its registration will be removed — no creative
                is affected.
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
              <span className="text-ink" dir="auto">
                {campaignName}
              </span>
              {summary.adSets > 0 ? `, its ${plural(summary.adSets, "ad set")}` : ""}
              {hasRecords ? ` and ${plural(summary.records, "performance record")}.` : "."}
            </span>
          </label>

          <TypeToConfirm
            phrase={campaignName}
            value={typed}
            onChange={setTyped}
            disabled={isPending}
            inputClassName="mt-1 h-8 w-full"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={!confirmed || isPending}>
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
