"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildCampaignName, CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { createCampaign } from "@/app/actions/campaign";

/**
 * Register a campaign. Mirrors how an upload builds the stored name: the buyer
 * gives Campaign + Ad Set + Platform and sees a live preview of the exact
 * `campaign_name` that will be stored (and matched against uploads).
 */
export function NewCampaignDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState("");
  const [adset, setAdset] = useState("");
  // No defaults — the buyer must pick deliberately so a left-on-default value
  // can't slip through.
  const [platform, setPlatform] = useState<string>("");
  const [objective, setObjective] = useState<string>("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preview = buildCampaignName(campaign, adset, platform);

  const reset = () => {
    setCampaign("");
    setAdset("");
    setPlatform("");
    setObjective("");
    setError(null);
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createCampaign({ campaign, adset, platform, objective });
      if (res.ok) {
        toast.success(`Campaign registered: ${res.name}`);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(res.error ?? "Could not register the campaign.");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Plus className="w-4 h-4" /> New campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register a campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
          <label className="block text-xs text-ink-2 space-y-1">
            <span>Platform</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full h-9 rounded-md border border-line bg-surface text-sm text-ink px-2 focus:outline-none focus:border-brand/50"
            >
              <option value="" disabled>
                Select a platform…
              </option>
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
              className="w-full h-9 rounded-md border border-line bg-surface text-sm text-ink px-2 focus:outline-none focus:border-brand/50"
            >
              <option value="" disabled>
                Select an objective…
              </option>
              {CAMPAIGN_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
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
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !campaign.trim() || !platform || !objective}
          >
            {pending ? "Creating…" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
