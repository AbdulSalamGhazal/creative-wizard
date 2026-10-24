"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildCampaignName,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_PLATFORM_LOCKED_TIP,
} from "@/lib/campaign";
import { InfoTip } from "@/components/ui/info-tip";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { updateCampaign } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { actionSettled } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import { useCan } from "@/components/auth/permissions-context";

/**
 * Edit a campaign's name (rebuilt from Campaign + Ad Set + Platform), platform
 * and objective. Pre-filled from the current values; shows a live preview of the
 * stored name (which uploads must match) and only enables Save when something
 * actually changed. On a rename the parent follows the new URL.
 */
export function CampaignEditDialog({
  id,
  currentName,
  campaign: initCampaign,
  adset: initAdset,
  platform: initPlatform,
  objective: initObjective,
  hasRecords,
}: {
  id: string;
  currentName: string;
  campaign: string;
  adset: string;
  platform: string;
  objective: string;
  /** Records exist → the platform is locked (D9); the server refuses it too. */
  hasRecords: boolean;
}) {
  const router = useRouter();
  const canEdit = useCan("campaign.edit");
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState(initCampaign);
  const [adset, setAdset] = useState(initAdset);
  const [platform, setPlatform] = useState(initPlatform);
  const [objective, setObjective] = useState(initObjective);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preview = buildCampaignName(campaign, adset, platform);
  const ready = Boolean(campaign.trim()) && Boolean(platform) && Boolean(objective);
  const dirty =
    preview !== currentName || platform !== initPlatform || objective !== initObjective;

  // Reset drafts to the current values whenever the dialog (re)opens.
  const onOpenChange = (next: boolean) => {
    if (pending) return; // don't allow closing mid-save
    if (next) {
      setCampaign(initCampaign);
      setAdset(initAdset);
      setPlatform(initPlatform);
      setObjective(initObjective);
      setError(null);
    }
    setOpen(next);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ready || !dirty) return;
    setError(null);
    start(async () => {
      const res = await safeAction(() =>
        updateCampaign({ id, campaign, adset, platform, objective }),
      );
      if (res.ok) {
        toast.success("Campaign updated");
        setOpen(false);
        // ONE render (W2-1): a rename follows the new URL (the action skips its
        // revalidation then); otherwise the action's re-render already arrived.
        if (res.name && res.name !== currentName) {
          await actionSettled();
          router.push(`/campaigns/${encodeURIComponent(res.name)}`);
        }
      } else {
        toastActionFailure(res, "Could not update the campaign.", { inline: setError });
      }
    });
  };

  if (!canEdit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>
            The stored name is rebuilt from Campaign + Ad Set + Platform. Existing
            performance keeps its link, but renaming changes what future uploads
            must match — rename your source the same way.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Campaign name">
            <Input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="e.g. Always-On"
              autoFocus
            />
          </Field>
          <Field label="Ad Set name">
            <Input
              value={adset}
              onChange={(e) => setAdset(e.target.value)}
              placeholder="e.g. Broad"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Platform"
              tip={
                hasRecords ? (
                  <InfoTip label="Why the platform is locked">{CAMPAIGN_PLATFORM_LOCKED_TIP}</InfoTip>
                ) : null
              }
            >
              <Select value={platform} onValueChange={setPlatform} disabled={hasRecords}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a platform…" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Objective">
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an objective…" />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_OBJECTIVES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-3 mb-0.5">
              Will be stored as
            </div>
            <div className="text-sm text-ink num break-all">
              {preview || <span className="text-ink-3">—</span>}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ready || !dirty}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  tip,
  children,
}: {
  label: string;
  /** An ⓘ beside the label — the reason a control is locked, say. */
  tip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {tip}
      </div>
      {children}
    </div>
  );
}
