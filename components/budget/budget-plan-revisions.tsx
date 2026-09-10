"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_LABEL } from "@/lib/palette";
import { int, plural, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { budgetComboKey, monthLabel } from "@/lib/budget";
import { restorePlanRevision } from "@/app/actions/budget";
import type { PlanRevisionRow } from "@/db/queries/budget";
import type { BudgetPlanSnapshot } from "@/validators/budget";

/** The current plan, in the same shape as a snapshot, for diffing. */
export interface CurrentPlan {
  allocations: Array<{ platform: string; objective: string; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  reserveSpendUsd: number;
  dayWeights: Record<number, number>;
}

interface AllocDiff {
  key: string;
  platform: string;
  objective: string;
  from: number | null; // the revision
  to: number | null; // the current plan
  kind: "added" | "removed" | "changed";
}

/**
 * What restoring this revision would change, expressed as CURRENT → REVISION:
 * "added" means the current plan has a row the revision doesn't (restoring
 * drops it), "removed" means the revision has one the current plan lost
 * (restoring brings it back). Reading it that way keeps the arrow pointing the
 * direction the button would actually move the plan.
 */
export function diffPlans(revision: BudgetPlanSnapshot, current: CurrentPlan) {
  const rev = new Map(
    revision.allocations.map((a) => [budgetComboKey(a.platform, a.objective), a.plannedSpend]),
  );
  const cur = new Map(
    current.allocations.map((a) => [budgetComboKey(a.platform, a.objective), a.plannedSpend]),
  );
  const rows: AllocDiff[] = [];
  for (const key of new Set([...rev.keys(), ...cur.keys()])) {
    const [platform, objective] = key.split("|") as [string, string];
    const from = rev.get(key) ?? null;
    const to = cur.get(key) ?? null;
    if (from === to) continue;
    rows.push({
      key,
      platform,
      objective,
      from,
      to,
      kind: from === null ? "added" : to === null ? "removed" : "changed",
    });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : 1));

  // Compare the curves by PLACEMENT, not by how many days are weighted:
  // {15: 2} and {20: 3} are the same count and a completely different month.
  // A stored weight of 1 is the default, so it counts as absent either side.
  const meaningful = (weights: Record<string | number, number>) =>
    Object.entries(weights)
      .filter(([, w]) => w !== 1)
      .map(([day, w]) => `${Number(day)}:${w}`)
      .sort()
      .join(",");
  const revCurve = meaningful(revision.dayWeights);
  const curCurve = meaningful(current.dayWeights);
  const revWeights = Object.values(revision.dayWeights).filter((w) => w !== 1).length;
  const curWeights = Object.values(current.dayWeights).filter((w) => w !== 1).length;
  return {
    rows,
    revenueChanged: revision.plannedRevenueSar !== current.plannedRevenueSar,
    reserveChanged: revision.reserveSpendUsd !== current.reserveSpendUsd,
    weightsChanged: revCurve !== curCurve,
    revWeights,
    curWeights,
    identical:
      rows.length === 0 &&
      revision.plannedRevenueSar === current.plannedRevenueSar &&
      revision.reserveSpendUsd === current.reserveSpendUsd &&
      revCurve === curCurve,
  };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The Plan tab's revision drawer. Every plan write since the feature shipped
 * leaves a snapshot; this lists them newest-first, shows the selected one
 * read-only, and diffs it against the plan as it stands now. Restoring is
 * gated by `budget.manage` — everyone else can still read the history.
 */
export function BudgetPlanRevisions({
  month,
  revisions,
  current,
  canManage,
}: {
  month: string;
  revisions: PlanRevisionRow[];
  current: CurrentPlan;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const selected = revisions.find((r) => r.id === selectedId) ?? null;
  const diff = useMemo(
    () => (selected?.snapshot ? diffPlans(selected.snapshot, current) : null),
    [selected, current],
  );

  const restore = async () => {
    if (!selected) return;
    setIsPending(true);
    try {
      const res = await restorePlanRevision({ revisionId: selected.id });
      if (!res.ok) {
        toast.error(res.error ?? "Could not restore that revision");
        return;
      }
      toast.success(`Restored the plan saved ${when(selected.createdAt)}`);
      setOpen(false);
      setSelectedId(null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History className="h-3.5 w-3.5" />
          Revisions
          {revisions.length > 0 && (
            <span className="ml-1 num text-ink-3">{int(revisions.length)}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(34rem,100vw)] overflow-y-auto sm:max-w-none">
        <SheetHeader>
          <SheetTitle>Plan revisions</SheetTitle>
          <SheetDescription>
            Every saved version of {monthLabel(month)}&rsquo;s plan, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {revisions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
              <p className="text-sm text-ink-2">No revisions yet.</p>
              <p className="mt-1 text-xs text-ink-3">
                Every save, copy, and restore records a snapshot of the plan, so
                you can compare and roll back later.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {revisions.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(active ? null : r.id)}
                      aria-expanded={active}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-brand/60 bg-surface-2"
                          : "border-line bg-surface hover:border-brand/40",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm text-ink">{when(r.createdAt)}</span>
                        <span className="num tabular-nums text-sm text-ink-2">
                          {usd(r.plannedTotal)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-ink-3">
                        <span>{r.savedBy}</span>
                        <span className="num">
                          {plural(r.allocationCount, "allocation")}
                        </span>
                      </div>
                      {r.note && <p className="mt-1 text-xs text-ink-2">{r.note}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">
                  Saved {when(selected.createdAt)}
                </h3>
                {canManage && selected.snapshot && (
                  <Button type="button" size="xs" onClick={restore} disabled={isPending}>
                    <RotateCcw className="h-3 w-3" />
                    Restore this plan
                  </Button>
                )}
              </div>

              {!selected.snapshot ? (
                <p className="text-xs text-warn">
                  This revision was stored in a format the app no longer recognises,
                  so it can&rsquo;t be shown or restored.
                </p>
              ) : (
                <>
                  {/* The snapshot, read-only */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink-3">
                        <th className="py-1 font-normal">Platform / objective</th>
                        <th className="py-1 text-right font-normal">Planned (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {selected.snapshot.allocations.length === 0 && (
                        <tr>
                          <td colSpan={2} className="py-2 text-ink-3">
                            No allocations in this revision.
                          </td>
                        </tr>
                      )}
                      {selected.snapshot.allocations.map((a) => (
                        <tr key={budgetComboKey(a.platform, a.objective)}>
                          <td className="py-1">
                            <span className="inline-flex items-center gap-1.5">
                              <PlatformDot platform={a.platform as never} size="sm" />
                              <span className="text-ink-2">
                                {PLATFORM_LABEL[a.platform as keyof typeof PLATFORM_LABEL] ??
                                  a.platform}
                              </span>
                              <span className="text-ink-3">·</span>
                              {a.objective}
                            </span>
                          </td>
                          <td className="py-1 text-right num tabular-nums">
                            {usd(a.plannedSpend)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-ink-3">
                    Revenue target{" "}
                    {selected.snapshot.plannedRevenueSar !== null
                      ? sar(selected.snapshot.plannedRevenueSar)
                      : "—"}{" "}
                    · reserve {usd(selected.snapshot.reserveSpendUsd)} ·{" "}
                    {plural(selected.weightOverrides, "weighted day")}
                  </p>

                  {/* What restoring would change */}
                  <div className="border-t border-line pt-2">
                    <h4 className="text-label text-ink-3">Vs the current plan</h4>
                    {diff?.identical ? (
                      <p className="mt-1 text-xs text-ink-3">
                        Identical — restoring would change nothing.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {diff?.rows.map((d) => (
                          <li key={d.key} className="flex items-baseline justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-ink-2">
                              <PlatformDot platform={d.platform as never} size="sm" />
                              {d.objective}
                              <span className="rounded bg-surface-2 px-1 text-eyebrow text-ink-3">
                                {d.kind === "added"
                                  ? "would be dropped"
                                  : d.kind === "removed"
                                    ? "would return"
                                    : "would change"}
                              </span>
                            </span>
                            <span className="num tabular-nums whitespace-nowrap text-ink-2">
                              {d.to === null ? "—" : usd(d.to)} →{" "}
                              {d.from === null ? "—" : usd(d.from)}
                            </span>
                          </li>
                        ))}
                        {diff?.revenueChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Revenue target</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {current.plannedRevenueSar !== null
                                ? sar(current.plannedRevenueSar)
                                : "—"}{" "}
                              →{" "}
                              {selected.snapshot.plannedRevenueSar !== null
                                ? sar(selected.snapshot.plannedRevenueSar)
                                : "—"}
                            </span>
                          </li>
                        )}
                        {diff?.reserveChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Reserve</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {usd(current.reserveSpendUsd)} →{" "}
                              {usd(selected.snapshot.reserveSpendUsd)}
                            </span>
                          </li>
                        )}
                        {diff?.weightsChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Plan curve</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {diff.curWeights === diff.revWeights
                                ? `${int(diff.curWeights)} weighted days, moved`
                                : `${int(diff.curWeights)} → ${int(diff.revWeights)} weighted days`}
                            </span>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
