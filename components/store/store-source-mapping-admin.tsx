"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { int } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import {
  setStoreSourceField,
  setStoreSourceMapping,
} from "@/app/actions/store-source";
import type { StoreField } from "@/store/fields";

type Assignment = (typeof ALL_PLATFORMS)[number] | "none" | "unset";

interface Mapping {
  rawValue: string;
  platform: string | null;
}

/**
 * Configure the Store → Reconciliation source mapping (same tab as Store
 * fields). Pick which custom field holds the order's traffic source, then map
 * each raw value found in the data to an ad platform, "Not an ad platform", or
 * leave it Unmapped. Explicit only — nothing is auto-matched.
 */
export function StoreSourceMappingAdmin({
  fields,
  sourceFieldKey,
  mappings,
  values,
}: {
  fields: StoreField[];
  sourceFieldKey: string | null;
  mappings: Mapping[];
  values: Array<{ value: string; count: number }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();

  const customFields = fields.filter((f) => !f.core);
  const byValue = new Map(mappings.map((m) => [m.rawValue, m.platform] as const));

  const assignmentOf = (value: string): Assignment => {
    if (!byValue.has(value)) return "unset";
    const p = byValue.get(value);
    return (p ?? "none") as Assignment;
  };
  const unmappedCount = values.filter((v) => assignmentOf(v.value) === "unset").length;

  function pickField(next: string) {
    startTransition(async () => {
      const res = await setStoreSourceField({
        fieldKey: next === "__none__" ? null : next,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't set the source field");
        return;
      }
      toast.success("Source field updated");
      router.refresh();
    });
  }

  function assign(rawValue: string, assignment: Assignment) {
    startTransition(async () => {
      const res = await setStoreSourceMapping({ rawValue, assignment });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save the mapping");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-medium text-ink">Source mapping</h2>
        <p className="mt-1 text-xs text-ink-3">
          Powers Store → Reconciliation. Choose which custom field holds an
          order&rsquo;s traffic source, then map each value to an ad platform.
          Nothing is auto-matched.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 space-y-4">
        <div className="max-w-sm space-y-1.5">
          <Label>Source field</Label>
          {customFields.length === 0 ? (
            <p className="text-xs text-ink-3">
              Add a custom field above first (e.g. &ldquo;Source&rdquo;), then
              pick it here.
            </p>
          ) : (
            <Select
              value={sourceFieldKey ?? "__none__"}
              onValueChange={pickField}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not configured</SelectItem>
                {customFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {sourceFieldKey && (
          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">
                Values in your orders
              </span>
              {unmappedCount > 0 && (
                <span className="text-[11px] text-warn">
                  {int(unmappedCount)} unmapped
                </span>
              )}
            </div>

            {values.length === 0 ? (
              <p className="text-xs text-ink-3">
                No values found for this field yet — upload orders that carry it.
              </p>
            ) : (
              <div className="divide-y divide-line rounded-md border border-line">
                {values.map((v) => {
                  const current = assignmentOf(v.value);
                  const unmapped = current === "unset";
                  return (
                    <div
                      key={v.value}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-xs text-ink"
                        title={v.value}
                      >
                        {v.value}
                      </span>
                      <span className="text-[11px] text-ink-3 num shrink-0">
                        {int(v.count)}
                      </span>
                      {unmapped && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                          aria-label="Unmapped"
                        />
                      )}
                      <Select
                        value={current}
                        onValueChange={(a) => assign(v.value, a as Assignment)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-8 w-48 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p}>
                              <span className="flex items-center gap-2">
                                <PlatformDot platform={p} size="sm" />
                                {PLATFORM_LABEL[p]}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value="none">Not an ad platform</SelectItem>
                          <SelectItem value="unset">Unmapped</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
