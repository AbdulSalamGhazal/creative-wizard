"use client";

import { useCallback, useMemo, useState } from "react";
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
import { dateTimeLabel, int, plural, roas, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { budgetComboKey, monthLabel } from "@/lib/budget";
import { loadPlanRevision, restorePlanRevision } from "@/app/actions/budget";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { PlanRevisionSummary } from "@/db/queries/budget";
import { Skeleton } from "@/components/ui/skeleton";
import type { BudgetPlanSnapshot } from "@/validators/budget";
import { EmptyState } from "@/components/ui/empty-state";

/** The current plan, in the same shape as a snapshot, for diffing. */
export interface CurrentPlan {
  allocations: Array<{ platform: string; objective: string; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  reserveSpendUsd: number;
  dayWeights: Record<number, number>;
  /** Absent → a curve month with no day cells and no stored ROAS. */
  mode?: "curve" | "daily";
  days?: Array<{ day: number; platform: string; objective: string; plannedSpend: number }>;
  targetRoas?: number | null;
}

const MODE_LABEL: Record<"curve" | "daily", string> = { curve: "Curve", daily: "Day by day" };

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

  // A daily month is planned by its DAY CELLS, and carries its target ROAS:
  // the same totals spread differently — or a switch between curve and daily —
  // is a different plan. The diff used to compare only allocations, revenue,
  // reserve and curve weights, so a daily → curve revision read "Identical"
  // while restoring it reshaped the month (W1-13).
  const curMode = current.mode ?? "curve";
  const cells = (days: ReadonlyArray<{ day: number; platform: string; objective: string; plannedSpend: number }>) =>
    days
      .filter((d) => d.plannedSpend !== 0)
      .map((d) => `${d.day}|${budgetComboKey(d.platform, d.objective)}:${d.plannedSpend}`)
      .sort()
      .join(",");
  const modeChanged = revision.mode !== curMode;
  const daysChanged = cells(revision.days) !== cells(current.days ?? []);
  const curRoas = current.targetRoas ?? null;
  const targetRoasChanged = revision.targetRoas !== curRoas;
  return {
    rows,
    revenueChanged: revision.plannedRevenueSar !== current.plannedRevenueSar,
    reserveChanged: revision.reserveSpendUsd !== current.reserveSpendUsd,
    weightsChanged: revCurve !== curCurve,
    revWeights,
    curWeights,
    modeChanged,
    revMode: revision.mode,
    curMode,
    daysChanged,
    revDays: revision.days.length,
    curDays: (current.days ?? []).length,
    targetRoasChanged,
    revRoas: revision.targetRoas,
    curRoas,
    identical:
      rows.length === 0 &&
      revision.plannedRevenueSar === current.plannedRevenueSar &&
      revision.reserveSpendUsd === current.reserveSpendUsd &&
      revCurve === curCurve &&
      !modeChanged &&
      !daysChanged &&
      !targetRoasChanged,
  };
}

/** "Oct 20, 2026, 2:32 PM" — lib/format's absolute date + time. */
const when = (iso: string): string => dateTimeLabel(iso);

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
  revisions: PlanRevisionSummary[];
  current: CurrentPlan;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // SNAPSHOTS LOAD WHEN PICKED (D14, 2026-10): the page lists summaries only;
  // the picked revision's snapshot is fetched once and kept for this visit.
  const [snapshots, setSnapshots] = useState<Record<string, BudgetPlanSnapshot>>({});
  const [loadFailedId, setLoadFailedId] = useState<string | null>(null);

  const selected = revisions.find((r) => r.id === selectedId) ?? null;
  const snapshot = selectedId ? (snapshots[selectedId] ?? null) : null;
  const diff = useMemo(
    () => (snapshot ? diffPlans(snapshot, current) : null),
    [snapshot, current],
  );

  const loadSnapshot = useCallback(async (id: string) => {
    setLoadFailedId(null);
    const res = await safeAction(() => loadPlanRevision({ revisionId: id }));
    if (!res.ok || !("snapshot" in res)) {
      setLoadFailedId(id);
      // A stale tab is told to reload; anything else is said inline below.
      if ("stale" in res && res.stale) toastActionFailure(res, "Couldn't load that revision");
      return;
    }
    setSnapshots((m) => ({ ...m, [id]: res.snapshot }));
  }, []);

  const pick = (r: PlanRevisionSummary) => {
    const next = r.id === selectedId ? null : r.id;
    setSelectedId(next);
    if (next && r.readable && !snapshots[next]) void loadSnapshot(next);
  };

  const restore = async () => {
    if (!selected) return;
    setIsPending(true);
    try {
      const res = await safeAction(() => restorePlanRevision({ revisionId: selected.id }));
      if (!res.ok) {
        toastActionFailure(res, "Could not restore that revision");
        return;
      }
      // The action revalidated: the restored plan arrived in its response.
      toast.success(`Restored the plan saved ${when(selected.createdAt)}`);
      setOpen(false);
      setSelectedId(null);
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
            <EmptyState
              title="No revisions yet."
              hint="Every save, copy, and restore records a snapshot of the plan, so you can compare and roll back later."
            />
          ) : (
            <ul className="space-y-1.5">
              {revisions.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pick(r)}
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
                        <span>
                          {r.savedBy}
                          {r.mode === "daily" && (
                            <span className="ml-1.5 rounded bg-surface-2 px-1 text-eyebrow text-ink-3">
                              day by day
                            </span>
                          )}
                        </span>
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
                {canManage && selected.readable && (
                  <Button type="button" size="xs" onClick={restore} disabled={isPending}>
                    <RotateCcw className="h-3 w-3" />
                    Restore this plan
                  </Button>
                )}
              </div>

              {!selected.readable ? (
                <p className="text-xs text-warn">
                  This revision was stored in a format the app no longer recognises,
                  so it can&rsquo;t be shown or restored.
                </p>
              ) : !snapshot ? (
                loadFailedId === selected.id ? (
                  <p className="text-xs text-ink-3">
                    Couldn&rsquo;t load this revision{" "}
                    <span aria-hidden>·</span>{" "}
                    <button
                      type="button"
                      onClick={() => void loadSnapshot(selected.id)}
                      className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      Retry
                    </button>
                  </p>
                ) : (
                  // The snapshot's shape while it loads: the allocation table's
                  // header and rows, the summary line, the diff block.
                  <div className="space-y-2" aria-busy="true" aria-label="Loading this revision">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    {Array.from({ length: Math.max(1, Math.min(selected.allocationCount, 6)) }).map(
                      (_, i) => (
                        <div key={i} className="flex justify-between">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      ),
                    )}
                    <Skeleton className="h-3 w-3/4" />
                    <div className="border-t border-line pt-2 space-y-1.5">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                )
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
                      {snapshot.allocations.length === 0 && (
                        <tr>
                          <td colSpan={2} className="py-2 text-ink-3">
                            No allocations in this revision.
                          </td>
                        </tr>
                      )}
                      {snapshot.allocations.map((a) => (
                        <tr key={budgetComboKey(a.platform, a.objective)}>
                          <td className="py-1">
                            <span className="inline-flex items-center gap-1.5">
                              <PlatformDot platform={a.platform} size="sm" />
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
                    {snapshot.plannedRevenueSar !== null
                      ? sar(snapshot.plannedRevenueSar)
                      : "—"}{" "}
                    · reserve {usd(snapshot.reserveSpendUsd)} ·{" "}
                    {selected.mode === "daily"
                      ? `planned day by day (${plural(selected.dayCells, "day cell")}${
                          snapshot.targetRoas !== null
                            ? `, ROAS ${roas(snapshot.targetRoas)}`
                            : ""
                        }) — restoring brings the days back`
                      : plural(selected.weightOverrides, "weighted day")}
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
                              <PlatformDot platform={d.platform} size="sm" />
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
                              {snapshot.plannedRevenueSar !== null
                                ? sar(snapshot.plannedRevenueSar)
                                : "—"}
                            </span>
                          </li>
                        )}
                        {diff?.reserveChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Reserve</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {usd(current.reserveSpendUsd)} →{" "}
                              {usd(snapshot.reserveSpendUsd)}
                            </span>
                          </li>
                        )}
                        {diff?.modeChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Planned</span>
                            <span className="whitespace-nowrap">
                              {MODE_LABEL[diff.curMode]} → {MODE_LABEL[diff.revMode]}
                            </span>
                          </li>
                        )}
                        {diff?.daysChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Day cells</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {diff.curDays === diff.revDays
                                ? `${int(diff.curDays)} cells, changed`
                                : `${int(diff.curDays)} → ${int(diff.revDays)} cells`}
                            </span>
                          </li>
                        )}
                        {diff?.targetRoasChanged && (
                          <li className="flex items-baseline justify-between gap-2 text-ink-2">
                            <span>Target ROAS</span>
                            <span className="num tabular-nums whitespace-nowrap">
                              {roas(diff.curRoas)} →{" "}
                              {roas(diff.revRoas)}
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
