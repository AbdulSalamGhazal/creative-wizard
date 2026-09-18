import { BUDGET_OBJECTIVES, type BudgetObjective } from "@/lib/budget";

/**
 * The three funnel stages — the app's ONE definition, derived from
 * `BUDGET_OBJECTIVES` minus the "Other" catch-all: a thing has a position in
 * the funnel or it isn't part of one.
 *
 * Hoisted out of `lib/audience.ts` (which now re-exports these) so the creative
 * side can use the same vocabulary without importing the audience module's
 * carry-forward machinery. Never re-list the values anywhere.
 *
 * Two DIFFERENT axes share these names, deliberately:
 *   - `creatives.stages` — the team's MANUAL declaration of where a creative
 *     sits in the funnel (this module's `STAGE_*` helpers).
 *   - `budget_allocations.objective` / audience snapshots — the budget bucket.
 * A creative declared Retargeting can spend inside an Awareness campaign; that
 * mismatch is information, not an error.
 */
export type FunnelStage = Exclude<BudgetObjective, "Other">;

const DERIVED_STAGES = BUDGET_OBJECTIVES.filter((o): o is FunnelStage => o !== "Other");

/** Typed as a non-empty tuple so `z.enum` can take it directly — the VALUES
 *  still come from the filter above, never a hand-written list. */
export const FUNNEL_STAGES: readonly [FunnelStage, ...FunnelStage[]] = [
  DERIVED_STAGES[0]!,
  ...DERIVED_STAGES.slice(1),
];

/** The funnel shorthand the team says out loud. Typed per stage, so a change
 *  to the objective axis fails to compile until this map follows. */
export const STAGE_SHORT: Record<FunnelStage, string> = {
  Awareness: "TOF",
  Activation: "MOF",
  Retargeting: "BOF",
};

/** Both names, because the team uses both: "Awareness · TOF". */
export function stageLabel(stage: FunnelStage): string {
  return `${stage} · ${STAGE_SHORT[stage]}`;
}

export function isFunnelStage(value: string): value is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}

/** Funnel order: Awareness → Activation → Retargeting. */
export function stageRank(stage: string): number {
  const i = (FUNNEL_STAGES as readonly string[]).indexOf(stage);
  return i === -1 ? FUNNEL_STAGES.length : i;
}

/**
 * Normalize a stage SET: unrecognised values dropped, duplicates collapsed,
 * funnel order applied. A set never depends on click order or on how many
 * times a value arrived.
 */
export function sortStages(stages: readonly string[]): FunnelStage[] {
  return [...new Set(stages.filter(isFunnelStage))].sort(
    (a, b) => stageRank(a) - stageRank(b),
  );
}

/** Filter tokens as they travel in the URL — "unassigned" is a real choice. */
export const STAGE_FILTER_VALUES = [
  ...FUNNEL_STAGES,
  "unassigned",
] as const;
export type StageFilterValue = (typeof STAGE_FILTER_VALUES)[number];

export function stageFilterLabel(value: string): string {
  return value === "unassigned" ? "Unassigned" : isFunnelStage(value) ? stageLabel(value) : value;
}

/** Split filter tokens into the stage set and the "unassigned" flag. */
export function splitStageFilter(
  values: readonly string[],
): { stages: FunnelStage[]; unassigned: boolean } {
  const stages: FunnelStage[] = [];
  let unassigned = false;
  for (const v of values) {
    if (v === "unassigned") unassigned = true;
    else if (isFunnelStage(v) && !stages.includes(v)) stages.push(v);
  }
  return { stages: sortStages(stages), unassigned };
}

/**
 * Sort comparator for a creative's stage set: by its EARLIEST stage in funnel
 * order, with UNASSIGNED ALWAYS LAST — in both directions.
 *
 * A creative on {Awareness, Retargeting} sorts as Awareness: the earliest
 * stage is where it enters the funnel. Unassigned means nobody has declared a
 * stage yet, which is an absence of judgment rather than a late one — the same
 * rule Priority follows for unrated. `dir` is 1 ascending (TOF → BOF), -1
 * descending.
 */
export function compareStages(
  a: readonly string[],
  b: readonly string[],
  dir: 1 | -1,
): number {
  const rankOf = (set: readonly string[]): number | null => {
    const ranks = set.filter(isFunnelStage).map(stageRank);
    return ranks.length === 0 ? null : Math.min(...ranks);
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  const d = (ra - rb) * dir;
  return d === 0 ? 0 : d;
}
