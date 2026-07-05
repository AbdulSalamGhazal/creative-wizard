"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
    <form
      onSubmit={submit}
      className="rounded-lg border border-line bg-surface p-5 space-y-4"
    >
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
        <Field label="Platform">
          <Select value={platform} onValueChange={setPlatform}>
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

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/campaigns")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Creating…" : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
