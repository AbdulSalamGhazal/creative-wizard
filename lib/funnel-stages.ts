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

/**
 * "No clear stage" — an EXPLICIT declaration, and a CREATIVE-SIDE value only
 * (2026-09). It is deliberately NOT in `FUNNEL_STAGES`: that list is the funnel
 * itself, and it also feeds the Audience matrix and the Budget-bucket mapping,
 * where an "N/A" row would be nonsense.
 *
 * THREE STATES, not two:
 *   - `[]` unassigned — nobody has declared a stage yet (absence of judgment);
 *   - `["N/A"]` — declared: this creative has no clear funnel stage;
 *   - `["Awareness", …]` — declared stages.
 * N/A is EXCLUSIVE: a creative is N/A or carries real stages, never both. The
 * picker normalizes to that, and `stagesSchema` REJECTS the contradiction so a
 * hand-rolled request can't store it.
 */
export const NA_STAGE = "N/A" as const;
export type NaStage = typeof NA_STAGE;

/** What a CREATIVE may declare — the funnel, plus N/A. Never the audience or
 *  budget axes: those stay on `FUNNEL_STAGES`. */
export const CREATIVE_STAGE_OPTIONS: readonly [FunnelStage | NaStage, ...(FunnelStage | NaStage)[]] =
  [...FUNNEL_STAGES, NA_STAGE];
export type CreativeStage = FunnelStage | NaStage;

/** The funnel shorthand the team says out loud. Typed per stage, so a change
 *  to the objective axis fails to compile until this map follows. N/A IS its
 *  own short form — there is no three-letter word for "no stage". */
export const STAGE_SHORT: Record<CreativeStage, string> = {
  Awareness: "TOF",
  Activation: "MOF",
  Retargeting: "BOF",
  [NA_STAGE]: NA_STAGE,
};

/** Both names, because the team uses both: "Awareness · TOF". N/A has one. */
export function stageLabel(stage: CreativeStage): string {
  return stage === NA_STAGE ? NA_STAGE : `${stage} · ${STAGE_SHORT[stage]}`;
}

export function isFunnelStage(value: string): value is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}

/** A value a creative may carry — a funnel stage or the explicit N/A. */
export function isCreativeStage(value: string): value is CreativeStage {
  return (CREATIVE_STAGE_OPTIONS as readonly string[]).includes(value);
}

/** Funnel order: Awareness → Activation → Retargeting → N/A (last). */
export function stageRank(stage: string): number {
  const i = (CREATIVE_STAGE_OPTIONS as readonly string[]).indexOf(stage);
  return i === -1 ? CREATIVE_STAGE_OPTIONS.length : i;
}

/**
 * Normalize a stage SET: unrecognised values dropped, duplicates collapsed,
 * funnel order applied (N/A last). A set never depends on click order or on
 * how many times a value arrived. Ordering only — EXCLUSIVITY is the schema's
 * job, so a stored contradiction is shown as it is rather than hidden here.
 */
export function sortStages(stages: readonly string[]): CreativeStage[] {
  return [...new Set(stages.filter(isCreativeStage))].sort(
    (a, b) => stageRank(a) - stageRank(b),
  );
}

/**
 * Filter tokens as they travel in the URL. Both declared-but-N/A and
 * never-declared are real choices, and they are DIFFERENT questions: "N/A"
 * matches the explicit declaration, "unassigned" matches an empty set.
 */
export const STAGE_FILTER_VALUES = [
  ...CREATIVE_STAGE_OPTIONS,
  "unassigned",
] as const;
export type StageFilterValue = (typeof STAGE_FILTER_VALUES)[number];

export function stageFilterLabel(value: string): string {
  return value === "unassigned" ? "Unassigned" : isCreativeStage(value) ? stageLabel(value) : value;
}

/** Split filter tokens into the stage set and the "unassigned" flag. */
export function splitStageFilter(
  values: readonly string[],
): { stages: CreativeStage[]; unassigned: boolean } {
  const stages: CreativeStage[] = [];
  let unassigned = false;
  for (const v of values) {
    if (v === "unassigned") unassigned = true;
    else if (isCreativeStage(v) && !stages.includes(v)) stages.push(v);
  }
  return { stages: sortStages(stages), unassigned };
}

/**
 * Sort comparator for a creative's stage set: by its EARLIEST stage in funnel
 * order — N/A after the three, UNASSIGNED ALWAYS LAST, in both directions.
 *
 * A creative on {Awareness, Retargeting} sorts as Awareness: the earliest
 * stage is where it enters the funnel. N/A is a DECLARATION, so it sorts (last
 * of the declared); unassigned means nobody has declared a stage yet, which is
 * an absence of judgment rather than a late one — the same rule Priority
 * follows for unrated. `dir` is 1 ascending (TOF → BOF), -1 descending.
 */
export function compareStages(
  a: readonly string[],
  b: readonly string[],
  dir: 1 | -1,
): number {
  const rankOf = (set: readonly string[]): number | null => {
    const ranks = set.filter(isCreativeStage).map(stageRank);
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
