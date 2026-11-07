import type { VersionData } from "@/price-structure/engine/types";

/**
 * Which parts of a version an edit changed — the words a version's Activity
 * uses (2026-11-07). Pure. A version autosaves 500 ms after typing stops, so
 * the history records SECTIONS, not saves: one line per person per section
 * per sitting ("edited products, targets"), never one per keystroke.
 */
export const EDIT_SECTIONS = [
  "name",
  "notes",
  "settings",
  "products",
  "targets",
  "plans",
  "actuals",
] as const;
export type EditSection = (typeof EDIT_SECTIONS)[number];

/** How long a person's edits to one version count as one sitting. */
export const EDIT_SITTING_MS = 30 * 60 * 1000;

interface Doc {
  name: string;
  notes: string;
  data: VersionData;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The sections that differ between two states of a version, in display order. */
export function changedSections(before: Doc, after: Doc): EditSection[] {
  const diff: Record<EditSection, boolean> = {
    name: before.name !== after.name,
    notes: before.notes !== after.notes,
    settings: !same(before.data.settings, after.data.settings),
    products: !same(before.data.products, after.data.products),
    // The ROAS target choice belongs with the targets; the active plan with the plans.
    targets:
      !same(before.data.targets, after.data.targets) ||
      before.data.roasTargetId !== after.data.roasTargetId,
    plans:
      !same(before.data.plans, after.data.plans) ||
      before.data.activePlanId !== after.data.activePlanId,
    actuals: !same(before.data.actuals, after.data.actuals),
  };
  return EDIT_SECTIONS.filter((s) => diff[s]);
}

/**
 * The sections this save adds to the person's current sitting — what a new
 * history line should name. Empty: the sitting already says it, write nothing.
 */
export function newEditSections(
  changed: readonly EditSection[],
  alreadyInSitting: readonly string[],
): EditSection[] {
  const seen = new Set(alreadyInSitting);
  return changed.filter((s) => !seen.has(s));
}
