import {
  Activity,
  AtSign,
  Bell,
  Clock,
  Flag,
  Gauge,
  Globe,
  Layers,
  Package,
  Reply,
  Share2,
  Shapes,
  Tag,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { FilterDef } from "@/components/filters/filter-model";

/**
 * The filter dialog's leading icons, keyed by the URL PARAM — one map, so the
 * same filter wears the same icon on every page that has it. That is the whole
 * point: a page declares a def, not a look, and "stage" must not be Layers on
 * Ads and something else on Library.
 *
 * Keys that mean the same thing share an entry (`status` on Ads is `statuses`
 * elsewhere). A key with NO entry renders no icon at all — the rows still
 * align, but nothing invents a glyph for a filter nobody chose one for.
 */
export const FILTER_KEY_ICONS: Readonly<Record<string, LucideIcon>> = {
  // The tier-1 control on most pages; a tier-2 def on Store Insights, where
  // it is the mapped platform LENS — the same question, so the same icon.
  platforms: Share2,
  status: Activity,
  statuses: Activity,
  productIds: Package,
  types: Shapes,
  angles: Tag,
  // Flag matches the priority PILL's own mark, so the row and the chip agree.
  priorities: Flag,
  stages: Layers,
  objectives: Target,
  rate: Gauge,
  channels: Globe,
};

/** A def's icon: its own if it declared one, else the one its KEY implies. */
export function filterIcon(def: FilterDef): LucideIcon | null {
  return def.icon ?? FILTER_KEY_ICONS[def.key] ?? null;
}

/** True when ANY of these defs shows an icon — the row's slot is reserved
 *  for all of them or none, so labels line up either way. */
export function anyFilterIcon(defs: readonly FilterDef[]): boolean {
  return defs.some((d) => filterIcon(d) !== null);
}

/**
 * NOTIFICATION CATEGORY glyphs, in the SAME map file as the filter icons
 * (2026-10) — one place where the app decides what a concept looks like. The
 * two keyspaces don't overlap today (filters are URL params, these are
 * categories), and keeping them together is what stops a third icon map from
 * appearing the next time something needs a glyph.
 */
export const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  system: Bell,
  mention: AtSign,
  reply: Reply,
  alert: TriangleAlert,
  reminder: Clock,
};

/** A category's glyph, or the system bell for a category nobody mapped. */
export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Bell;
}
