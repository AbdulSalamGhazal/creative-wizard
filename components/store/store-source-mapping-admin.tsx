"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { setStoreSourceMapping } from "@/app/actions/store-source";
import { setStoreChannelMapping } from "@/app/actions/store-channel";
import {
  CHANNEL_DESTINATIONS,
  CHANNEL_LABEL,
  type ChannelDestination,
} from "@/store/channels";

type Assignment = (typeof ALL_PLATFORMS)[number] | "none" | "unset";
type ChannelAssignment = ChannelDestination | "unset";

interface Mapping {
  rawValue: string;
  platform: string | null;
}

/**
 * Configure the Store → Reconciliation mappings (same tab as Store fields).
 * TWO axes, and nothing else is configurable:
 *
 *   1. UTM source → ad platform. The source FIELD picker is retired — the
 *      source is always `utm_source` now (a system-required field), so there is
 *      nothing to choose, only values to map.
 *   2. Channel → Website / Application. Says WHERE the purchase happened,
 *      which is what makes "Δ excl. app" an honest attribution gap.
 *
 * Explicit only — nothing is auto-matched, and an unmapped value stays in its
 * own visible bucket rather than being folded into a neighbour.
 */
export function StoreSourceMappingAdmin({
  mappings,
  values,
  channelMappings,
  channelValues,
}: {
  mappings: Mapping[];
  values: Array<{ value: string; count: number }>;
  channelMappings: Array<{ rawValue: string; destination: ChannelDestination }>;
  channelValues: Array<{ value: string; count: number }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();

  const byValue = new Map(mappings.map((m) => [m.rawValue, m.platform] as const));
  const byChannel = new Map(
    channelMappings.map((m) => [m.rawValue, m.destination] as const),
  );
  const channelAssignmentOf = (value: string): ChannelAssignment =>
    byChannel.get(value) ?? "unset";
  const unmappedChannelCount = channelValues.filter(
    (v) => channelAssignmentOf(v.value) === "unset",
  ).length;

  const assignmentOf = (value: string): Assignment => {
    if (!byValue.has(value)) return "unset";
    const p = byValue.get(value);
    return (p ?? "none") as Assignment;
  };
  const unmappedCount = values.filter((v) => assignmentOf(v.value) === "unset").length;

  function assignChannel(rawValue: string, assignment: ChannelAssignment) {
    startTransition(async () => {
      const res = await setStoreChannelMapping({ rawValue, assignment });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save the mapping");
        return;
      }
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
        <h2 className="text-sm font-medium text-ink">Reconciliation mapping</h2>
        <p className="mt-1 text-xs text-ink-3">
          Two axes, both EXPLICIT — nothing is auto-matched. The traffic source
          always comes from the <span className="font-mono">UTM source</span>{" "}
          field; the channel says where the purchase happened.
        </p>
      </div>

      {/* ── Axis 1: UTM source → platform ───────────────────────────────── */}
      <div className="rounded-lg border border-line bg-surface p-4 space-y-4">
        <div>
          <h3 className="text-xs font-medium text-ink">UTM source → platform</h3>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Which ad platform each source value belongs to. Unmapped values count
            as Unattributed.
          </p>
        </div>

        {(
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

      {/* ── Axis 2: channel → Website / Application ─────────────────────── */}
      <div className="rounded-lg border border-line bg-surface p-4 space-y-4">
        <div>
          <h3 className="text-xs font-medium text-ink">
            Channel → Website / Application
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Where the purchase happened. Platform pixels largely see website
            purchases, so this is what separates the honest attribution gap from
            app orders. Unmapped values stay their own bucket — never folded into
            either side.
          </p>
        </div>

        <div className="space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-2">
              Values in your orders
            </span>
            {unmappedChannelCount > 0 && (
              <span className="text-[11px] text-warn">
                {int(unmappedChannelCount)} unmapped
              </span>
            )}
          </div>

          {channelValues.length === 0 ? (
            <p className="text-xs text-ink-3">
              No channel values found yet — upload orders that carry the column.
            </p>
          ) : (
            <div className="divide-y divide-line rounded-md border border-line">
              {channelValues.map((v) => {
                const current = channelAssignmentOf(v.value);
                return (
                  <div key={v.value} className="flex items-center gap-3 px-3 py-2">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-ink"
                      title={v.value}
                    >
                      {v.value}
                    </span>
                    <span className="text-[11px] text-ink-3 num shrink-0">
                      {int(v.count)}
                    </span>
                    {current === "unset" && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                        aria-label="Unmapped"
                      />
                    )}
                    <Select
                      value={current}
                      onValueChange={(a) =>
                        assignChannel(v.value, a as ChannelAssignment)
                      }
                      disabled={isPending}
                    >
                      <SelectTrigger className="h-8 w-48 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNEL_DESTINATIONS.map((d) => (
                          <SelectItem key={d} value={d}>
                            {CHANNEL_LABEL[d]}
                          </SelectItem>
                        ))}
                        <SelectItem value="unset">Unmapped</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
