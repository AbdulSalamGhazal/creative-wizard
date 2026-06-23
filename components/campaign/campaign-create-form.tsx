"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildCampaignName, CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { createCampaign } from "@/app/actions/campaign";

/**
 * Register a campaign. Mirrors how an upload builds the stored name — the buyer
 * gives Campaign + Ad Set + Platform + Objective and sees a live preview of the
 * exact `campaign_name` that will be stored (and matched against uploads).
 * Platform and Objective have NO default: they must be chosen deliberately so a
 * left-on-default value can't slip through.
 */
export function CampaignCreateForm() {
  const router = useRouter();
  const [campaign, setCampaign] = useState("");
  const [adset, setAdset] = useState("");
  const [platform, setPlatform] = useState("");
  const [objective, setObjective] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preview = buildCampaignName(campaign, adset, platform);
  const ready = Boolean(campaign.trim()) && Boolean(platform) && Boolean(objective);

  const submit = () => {
    if (!ready) return;
    setError(null);
    start(async () => {
      const res = await createCampaign({ campaign, adset, platform, objective });
      if (res.ok) {
        toast.success(`Campaign registered: ${res.name}`);
        router.push("/campaigns");
        router.refresh();
      } else {
        setError(res.error ?? "Could not register the campaign.");
      }
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
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

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button asChild variant="ghost" disabled={pending}>
          <Link href="/campaigns">Cancel</Link>
        </Button>
        <Button type="button" onClick={submit} disabled={pending || !ready}>
          {pending ? "Creating…" : "Create campaign"}
        </Button>
      </div>
    </div>
  );
}
