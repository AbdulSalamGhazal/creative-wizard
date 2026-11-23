"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "@/lib/brand-nav";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AD_NETWORK_LABEL,
  AD_NETWORKS,
  campaignNameHasSeparator,
  campaignPath,
  isAdNetwork,
  type AdNetwork,
} from "@/lib/campaign";
import { createParentCampaign } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { actionSettled } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import { useNavTransition } from "@/lib/nav-progress";
import { panelClass } from "@/components/ui/panel";
import {
  AdSetRows,
  adSetDrafts,
  adSetRowsReady,
  newAdSetRow,
  type AdSetRowDraft,
} from "@/components/campaign/ad-set-rows";

/**
 * Register a CAMPAIGN with its first ad sets (2026-11) — both levels on one
 * screen. The campaign is a name on one ad platform (Meta = Instagram +
 * Facebook); each ad set under it is a name, an objective and, on Meta, where
 * it runs. The row shows the exact name an upload must match. Platform and
 * objective have NO default: both are picked deliberately.
 */
export function CampaignCreateForm() {
  const router = useRouter();
  // Ties each label to its control (see Field).
  const fid = useId();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<AdNetwork | "">("");
  const [rows, setRows] = useState<AdSetRowDraft[]>([]);
  const [pending, start] = useTransition();
  // Navigations show the progress bar (W3-6).
  const [, startNav] = useNavTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [adSetErrors, setAdSetErrors] = useState<Record<number, string>>({});

  const nameError = campaignNameHasSeparator(name)
    ? "A campaign name can’t contain ➤"
    : fieldErrors.name || null;
  const ready =
    name.trim() !== "" && !campaignNameHasSeparator(name) && network !== "" && adSetRowsReady(rows);

  const pickNetwork = (value: string) => {
    if (!isAdNetwork(value)) return;
    setNetwork(value);
    setAdSetErrors({});
    // The rows follow the platform: their names and objectives are kept, the
    // platforms they run on become the new network's.
    setRows((prev) =>
      prev.length === 0
        ? [newAdSetRow(value)]
        : prev.map((r) => ({ ...newAdSetRow(value, r.name, r.objective), key: r.key })),
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    // `ready` already requires a platform; this pins the narrowed value for
    // the transition's closure.
    const chosen: AdNetwork = network;
    setError(null);
    setFieldErrors({});
    setAdSetErrors({});
    start(async () => {
      const res = await safeAction(() =>
        createParentCampaign({ name, network: chosen, adSets: adSetDrafts(rows) }),
      );
      if (res.ok && res.name && res.network) {
        toast.success(`Created “${res.name}”`);
        // ONE render: the action doesn't revalidate; this navigation renders
        // the new campaign's page (W2-1) — once the router is done with the action.
        await actionSettled();
        const href = campaignPath(res.network, res.name);
        startNav(() => router.push(href));
        return;
      }
      if ("fieldErrors" in res && res.fieldErrors) setFieldErrors(res.fieldErrors);
      if ("adSetErrors" in res && res.adSetErrors) setAdSetErrors(res.adSetErrors);
      toastActionFailure(res, "Couldn't register the campaign", { inline: setError });
    });
  };

  return (
    <form onSubmit={submit} className={`${panelClass()} space-y-5`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="Campaign name" htmlFor={`${fid}-name`} error={nameError}>
          <Input
            id={`${fid}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors({});
            }}
            placeholder="e.g. Always-On"
            autoFocus
            dir="auto"
          />
        </Field>
        <Field label="Platform" htmlFor={`${fid}-network`} error={fieldErrors.network || null}>
          <Select value={network} onValueChange={pickNetwork}>
            <SelectTrigger id={`${fid}-network`}>
              <SelectValue placeholder="Select a platform…" />
            </SelectTrigger>
            <SelectContent>
              {AD_NETWORKS.map((n) => (
                <SelectItem key={n} value={n}>
                  {AD_NETWORK_LABEL[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-ink">Ad sets</h2>
        {network === "" ? (
          <p className="text-xs text-ink-2">Pick the platform first.</p>
        ) : (
          <AdSetRows
            network={network}
            campaignName={name}
            rows={rows}
            onChange={(next) => {
              setRows(next);
              setAdSetErrors({});
            }}
            errors={adSetErrors}
            disabled={pending}
          />
        )}
      </div>

      <FormError>{error}</FormError>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => startNav(() => router.push("/campaigns"))}
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
