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
import { buildCampaignName, CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { updateCampaign } from "@/app/actions/campaign";

const SELECT_CLASS =
  "w-full h-9 rounded-md border border-line bg-surface text-sm text-ink px-2 focus:outline-none focus:border-brand/50";

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
}: {
  id: string;
  currentName: string;
  campaign: string;
  adset: string;
  platform: string;
  objective: string;
}) {
  const router = useRouter();
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
    if (next) {
      setCampaign(initCampaign);
      setAdset(initAdset);
      setPlatform(initPlatform);
      setObjective(initObjective);
      setError(null);
    }
    setOpen(next);
  };

  const submit = () => {
    if (!ready || !dirty) return;
    setError(null);
    start(async () => {
      const res = await updateCampaign({ id, campaign, adset, platform, objective });
      if (res.ok) {
        toast.success("Campaign updated");
        setOpen(false);
        if (res.name && res.name !== currentName) {
          router.push(`/campaigns/${encodeURIComponent(res.name)}`);
        }
        router.refresh();
      } else {
        setError(res.error ?? "Could not update the campaign.");
      }
    });
  };

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

        <div className="space-y-4">
          <label className="block text-xs text-ink-2 space-y-1">
            <span>Campaign name</span>
            <Input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="e.g. Always-On"
              autoFocus
            />
          </label>
          <label className="block text-xs text-ink-2 space-y-1">
            <span>Ad Set name</span>
            <Input
              value={adset}
              onChange={(e) => setAdset(e.target.value)}
              placeholder="e.g. Broad"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-xs text-ink-2 space-y-1">
              <span>Platform</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className={SELECT_CLASS}
              >
                {ALL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-2 space-y-1">
              <span>Objective</span>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className={SELECT_CLASS}
              >
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-3 mb-0.5">
              Will be stored as
            </div>
            <div className="text-sm text-ink num break-all">
              {preview || <span className="text-ink-3">—</span>}
            </div>
          </div>

          {error && <p className="text-xs text-neg">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !ready || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
