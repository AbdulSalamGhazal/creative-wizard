"use client";

import { useId, useState, useTransition } from "react";
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
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SearchSelect } from "@/components/ui/search-select";
import { addAdSets } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useCan } from "@/components/auth/permissions-context";
import { useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { shallowParams } from "@/lib/shallow-url";
import { AD_NETWORK_LABEL, campaignPath, type AdNetwork } from "@/lib/campaign";
import {
  AdSetRows,
  adSetDrafts,
  adSetRowsReady,
  newAdSetRow,
  type AdSetRowDraft,
} from "@/components/campaign/ad-set-rows";

/** A campaign an ad set can be registered under. */
export interface AdSetCampaignChoice {
  id: string;
  name: string;
  network: AdNetwork;
}

type Props =
  | {
      /** ON a campaign's page: the campaign is given. */
      parentId: string;
      campaignName: string;
      network: AdNetwork;
      /** Ad-set names to start with, and to open on (from `?addAdSet=`). */
      prefill?: string[];
      campaigns?: undefined;
    }
  | {
      /** On the Ad sets LIST: the campaign is chosen in the dialog. */
      campaigns: AdSetCampaignChoice[];
      parentId?: undefined;
      campaignName?: undefined;
      network?: undefined;
      prefill?: undefined;
    };

/**
 * Register more ad sets under a campaign (2026-11) — the same rows as the
 * New campaign form. Two ways in:
 *
 * - "Add ad set" on a campaign's page: the campaign is the page's. `prefill`
 *   is the upload report's way in — an ad set a file named that this campaign
 *   doesn't have yet (E062 → `?addAdSet=<name>`): the dialog opens on it,
 *   ready for its objective.
 * - "New ad set" on the Ad sets list: the dialog asks WHICH campaign first
 *   (`campaigns`), then shows the same rows. The list itself only shows ad
 *   sets with records, so the success toast carries the way to the campaign.
 */
export function AddAdSetDialog(props: Props) {
  const canCreate = useCan("campaign.create");
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const fid = useId();
  const choosing = props.campaigns !== undefined;
  const prefill = props.prefill ?? [];
  const fixed: AdSetCampaignChoice | null = choosing
    ? null
    : { id: props.parentId, name: props.campaignName, network: props.network };

  const [pickedId, setPickedId] = useState<string | null>(null);
  const target = fixed ?? props.campaigns?.find((c) => c.id === pickedId) ?? null;

  const start0 = (): AdSetRowDraft[] =>
    fixed
      ? prefill.length > 0
        ? prefill.map((n) => newAdSetRow(fixed.network, n))
        : [newAdSetRow(fixed.network)]
      : [];
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
      setPickedId(null);
      setRows(fixed ? [newAdSetRow(fixed.network)] : []);
      setError(null);
      setAdSetErrors({});
    } else {
      dropPrefill();
    }
    setOpen(next);
  };

  /** Choosing a campaign: its network decides the rows' platforms, so a
   *  change of network starts the rows again; the same network keeps them. */
  const pick = (id: string | null) => {
    const next = props.campaigns?.find((c) => c.id === id) ?? null;
    setPickedId(next?.id ?? null);
    setError(null);
    setAdSetErrors({});
    if (!next) return setRows([]);
    if (rows.length === 0 || next.network !== target?.network) {
      setRows(
        rows.length > 0
          ? rows.map((r) => newAdSetRow(next.network, r.name, r.objective))
          : [newAdSetRow(next.network)],
      );
    }
  };

  /** The toast's way to the campaign — a later click, through the progress bar. */
  const openCampaign = (c: AdSetCampaignChoice) => {
    startNav(() => router.push(campaignPath(c.network, c.name)));
  };

  const ready = target !== null && adSetRowsReady(rows);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !target) return;
    setError(null);
    setAdSetErrors({});
    start(async () => {
      const res = await safeAction(() => addAdSets({ parentId: target.id, adSets: adSetDrafts(rows) }));
      if (res.ok) {
        const added = rows.length === 1 ? "Ad set added" : `${rows.length} ad sets added`;
        if (choosing) {
          // The list behind shows ad sets WITH records — a new one isn't in
          // it yet, so the toast is the way to where it now lives.
          toast.success(`${added} to ${target.name}`, {
            action: { label: "Open campaign", onClick: () => openCampaign(target) },
          });
        } else {
          // ONE render (W2-1): the action revalidated this page — the new ad
          // sets are already in the table behind the dialog.
          toast.success(added);
        }
        dropPrefill();
        setOpen(false);
        return;
      }
      if ("adSetErrors" in res && res.adSetErrors) setAdSetErrors(res.adSetErrors);
      toastActionFailure(res, "Couldn't add the ad set", { inline: setError });
    });
  };

  if (!canCreate) return null;
  // Nothing to choose from: the page offers "New campaign" alone.
  if (choosing && props.campaigns.length === 0) return null;

  const title = choosing ? "New ad set" : "Add ad set";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {choosing ? (
          <Button>
            <Plus className="w-4 h-4" /> New ad set
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="w-3.5 h-3.5" /> Add ad set
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {fixed && <span dir="auto">To {fixed.name}. </span>}
            Name it exactly as your ad-platform export does, so uploads line up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* `pb-2`: the sticky DialogFooter rides 8px up over whatever sits
              above it inside a form — enough to clip the "Add ad set" row
              button's lower edge. */}
          <div className="space-y-4 pb-2">
            {choosing && (
              <Field label="Campaign" htmlFor={`${fid}-campaign`}>
                <SearchSelect
                  id={`${fid}-campaign`}
                  options={props.campaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    hint: AD_NETWORK_LABEL[c.network],
                  }))}
                  value={pickedId}
                  onChange={pick}
                  placeholder="Choose a campaign…"
                  searchPlaceholder="Search campaigns…"
                  hintInTrigger
                  disabled={pending}
                />
              </Field>
            )}

            {target && (
              <AdSetRows
                network={target.network}
                campaignName={target.name}
                rows={rows}
                onChange={(next) => {
                  setRows(next);
                  setAdSetErrors({});
                }}
                errors={adSetErrors}
                disabled={pending}
              />
            )}

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
