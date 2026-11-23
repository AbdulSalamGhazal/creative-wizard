"use client";

import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
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
  networkPlatforms,
  type AdNetwork,
} from "@/lib/campaign";
import { PLATFORM_LABEL, type PlatformKey } from "@/lib/palette";

/** One ad set being typed into a form — a row of `AdSetRows`. */
export interface AdSetRowDraft {
  /** Stable React key; never sent. */
  key: string;
  name: string;
  /** "" until picked — an objective is always a deliberate choice. */
  objective: string;
  platforms: PlatformKey[];
}

let rowSeq = 0;

/**
 * A fresh row for a campaign on `network`. A Meta ad set starts ticked for
 * BOTH Instagram and Facebook (the usual case — one tick fewer than two
 * registrations); every other network has one platform, already chosen.
 */
export function newAdSetRow(network: AdNetwork, name = "", objective = ""): AdSetRowDraft {
  rowSeq += 1;
  return { key: `adset-${rowSeq}`, name, objective, platforms: networkPlatforms(network) };
}

/** The rows as the action's `adSets` — blank trailing rows are not sent. */
export function adSetDrafts(rows: readonly AdSetRowDraft[]) {
  return rows.map((r) => ({ name: r.name, objective: r.objective, platforms: r.platforms }));
}

/** Every row named, with an objective and at least one platform. */
export function adSetRowsReady(rows: readonly AdSetRowDraft[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((r) => r.name.trim() !== "" && r.objective !== "" && r.platforms.length > 0)
  );
}

/**
 * The ad sets of a campaign, as editable rows — shared by "New campaign" and
 * "Add ad set". Each row is a name, an objective and (on Meta) which of
 * Instagram / Facebook it runs on; under it, the exact name(s) an upload must
 * match (`buildCampaignName`, the same builder the server uses).
 */
export function AdSetRows({
  network,
  campaignName,
  rows,
  onChange,
  errors,
  disabled,
}: {
  network: AdNetwork;
  campaignName: string;
  rows: AdSetRowDraft[];
  onChange: (rows: AdSetRowDraft[]) => void;
  /** The server's per-row refusals, by row index. */
  errors?: Record<number, string>;
  disabled?: boolean;
}) {
  const fid = useId();
  const platformsOf = networkPlatforms(network);
  const multi = platformsOf.length > 1;

  const patch = (index: number, next: Partial<AdSetRowDraft>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...next } : r)));

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const error = errors?.[index];
        const errorId = `${fid}-${row.key}-error`;
        const stored = row.name.trim()
          ? row.platforms.map((p) => buildCampaignName(campaignName, row.name, p))
          : [];
        return (
          <div key={row.key} className="space-y-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
              <Input
                aria-label={`Ad set ${index + 1} name`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                value={row.name}
                onChange={(e) => patch(index, { name: e.target.value })}
                placeholder="e.g. Broad 18-45"
                disabled={disabled}
                dir="auto"
              />
              <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
                <Select
                  value={row.objective}
                  onValueChange={(objective) => patch(index, { objective })}
                  disabled={disabled}
                >
                  <SelectTrigger aria-label={`Ad set ${index + 1} objective`}>
                    <SelectValue placeholder="Objective…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_OBJECTIVES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* The only row can't be removed — so it has no Remove at all
                  (a disabled control would need to explain itself). */}
              {rows.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-start-2 row-start-1 text-ink-3 hover:text-ink sm:col-start-3"
                  aria-label={`Remove ad set ${index + 1}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <span aria-hidden className="col-start-2 row-start-1 size-9 sm:col-start-3" />
              )}
            </div>

            {multi && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {platformsOf.map((p) => (
                  <label
                    key={p}
                    className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-ink-2"
                  >
                    <Checkbox
                      aria-label={`Ad set ${index + 1} runs on ${PLATFORM_LABEL[p]}`}
                      checked={row.platforms.includes(p)}
                      onCheckedChange={(v) =>
                        patch(index, {
                          // Kept in the network's own order, whatever was ticked last.
                          platforms: platformsOf.filter((x) =>
                            x === p ? v === true : row.platforms.includes(x),
                          ),
                        })
                      }
                      disabled={disabled}
                    />
                    {PLATFORM_LABEL[p]}
                  </label>
                ))}
              </div>
            )}

            {stored.length > 0 && !error && (
              <p className="break-all text-xs text-ink-2" dir="auto">
                <span className="text-ink-3">In uploads: </span>
                {stored.join(" · ")}
              </p>
            )}
            <FormError id={errorId}>{error}</FormError>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          // The next row starts on the last one's objective — a campaign's ad
          // sets usually share it, and it stays one click to change.
          onChange([...rows, newAdSetRow(network, "", rows[rows.length - 1]?.objective ?? "")])
        }
        disabled={disabled || rows.length >= 50}
      >
        <Plus className="h-3.5 w-3.5" /> Add ad set
      </Button>
    </div>
  );
}
