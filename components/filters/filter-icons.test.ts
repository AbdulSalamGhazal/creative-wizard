import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Package, Sparkles } from "lucide-react";
import {
  FILTER_KEY_ICONS,
  anyFilterIcon,
  filterIcon,
} from "@/components/filters/filter-icons";
import type { FilterDef } from "@/components/filters/filter-model";

const multi = (key: string, extra: Partial<FilterDef> = {}): FilterDef =>
  ({
    key,
    label: key,
    type: "multi",
    options: [{ value: "a", label: "A" }],
    values: [],
    onChange: () => {},
    ...extra,
  }) as FilterDef;

/**
 * The dialog's row icons are keyed by the URL PARAM so the same filter wears
 * the same icon on every page. The guard that matters is therefore not "does
 * `stages` map to Layers" but "does every def the app declares resolve through
 * the ONE map" — pinned against the bars' own source, like migrated-bars.test.
 */
const BARS = [
  "components/summary/summary-filter-bar.tsx",
  "components/creative/library-filter-bar.tsx",
  "components/portfolio/portfolio-filter-bar.tsx",
  "components/canvas/canvas-filter-bar.tsx",
  "components/store/store-insights-view.tsx",
];

function declaredKeys(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^\s{6}key: "([^"]+)",$/gm)].map((m) => m[1]!);
}

describe("filterIcon", () => {
  it("derives from the key, so one filter looks the same everywhere", () => {
    expect(filterIcon(multi("productIds"))).toBe(FILTER_KEY_ICONS.productIds);
    // Ads calls it `status`, Library calls it `statuses` — same question.
    expect(filterIcon(multi("status"))).toBe(filterIcon(multi("statuses")));
    // Insights' platform LENS is the `platforms` key, so it inherits it.
    expect(filterIcon(multi("platforms"))).toBe(FILTER_KEY_ICONS.platforms);
  });

  it("lets a def override with its own icon", () => {
    expect(filterIcon(multi("productIds", { icon: Sparkles }))).toBe(Sparkles);
    expect(filterIcon(multi("nothing_maps_here", { icon: Package }))).toBe(Package);
  });

  it("renders NO icon for an unmapped key — no invented glyph", () => {
    expect(filterIcon(multi("creatorIds"))).toBeNull();
    expect(filterIcon(multi("metricFilters"))).toBeNull();
  });

  it("reserves the row slot only when something in the list has one", () => {
    expect(anyFilterIcon([multi("stages"), multi("creatorIds")])).toBe(true);
    expect(anyFilterIcon([multi("creatorIds")])).toBe(false);
    expect(anyFilterIcon([])).toBe(false);
  });
});

describe("every declared filter resolves through the one map", () => {
  for (const file of BARS) {
    it(`${file.split("/").at(-1)}: each def key is mapped or deliberately bare`, () => {
      const keys = declaredKeys(file);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        // `metricFilters` is the metric-rule builder — a CUSTOM def, and the
        // one def with no icon by decision. Everything else must be mapped, so
        // a new filter can't quietly ship without one.
        if (key === "metricFilters") continue;
        expect(FILTER_KEY_ICONS[key], `${key} has no icon`).toBeTruthy();
      }
    });
  }
});
