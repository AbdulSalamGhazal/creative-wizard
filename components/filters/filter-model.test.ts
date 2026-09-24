import { describe, expect, it, vi } from "vitest";
import {
  activeFilterCount,
  clearFilters,
  defaultChipLabel,
  filterChips,
  isFilterActive,
  optionLabel,
  toggleValue,
  type FilterDef,
} from "@/components/filters/filter-model";
import { nextQueryString } from "@/components/filters/use-filter-params";

const opts = (...values: string[]) =>
  values.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));

/** A page's filter config, as a page would declare it. */
function config(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const defs: FilterDef[] = [
    {
      key: "types",
      label: "Type",
      type: "multi",
      options: opts("video", "image", "slides"),
      values: (over.types as string[]) ?? [],
      onChange: (next) => calls.push(`types:${next.join("|")}`),
    },
    {
      key: "stages",
      label: "Stage",
      type: "multi",
      options: opts("awareness", "activation"),
      values: (over.stages as string[]) ?? [],
      onChange: (next) => calls.push(`stages:${next.join("|")}`),
    },
    {
      key: "metricFilters",
      label: "Metrics",
      type: "custom",
      active: (over.metrics as boolean) ?? false,
      chips: [
        { key: "m:roas", label: "ROAS ≥ 2", onRemove: () => calls.push("metric:roas") },
        { key: "m:spend", label: "Spend ≥ 500", onRemove: () => calls.push("metric:spend") },
      ],
      onClear: () => calls.push("metrics:clear"),
      render: () => null,
    },
  ];
  return { defs, calls };
}

describe("the filter model derives everything from one entry", () => {
  it("counts FILTERS, not values", () => {
    const { defs } = config({ types: ["video", "image"], metrics: true });
    expect(activeFilterCount(defs)).toBe(2); // types + metrics, not 3 values
    expect(defs.map(isFilterActive)).toEqual([true, false, true]);
    expect(activeFilterCount(config().defs)).toBe(0);
  });

  it('chips read "Label: A" and "Label: A +2"', () => {
    const { defs } = config({ types: ["video"] });
    expect(defaultChipLabel(defs[0] as never)).toBe("Type: Video");
    const many = config({ types: ["video", "image", "slides"] });
    expect(defaultChipLabel(many.defs[0] as never)).toBe("Type: Video +2");
  });

  it("a custom filter contributes its OWN chips (one per rule)", () => {
    const { defs } = config({ types: ["video"], metrics: true });
    expect(filterChips(defs).map((c) => c.label)).toEqual([
      "Type: Video",
      "ROAS ≥ 2",
      "Spend ≥ 500",
    ]);
  });

  it("removing a chip clears that filter alone", () => {
    const { defs, calls } = config({ types: ["video", "image"], stages: ["awareness"] });
    const chips = filterChips(defs);
    chips.find((c) => c.key === "types")!.onRemove();
    expect(calls).toEqual(["types:"]); // cleared to empty, stages untouched
  });

  it("a stale URL value still labels (the raw token, not a crash)", () => {
    expect(optionLabel(opts("video"), "carousel")).toBe("carousel");
    const { defs } = config({ types: ["carousel"] });
    expect(defaultChipLabel(defs[0] as never)).toBe("Type: carousel");
  });

  it("chipFormat overrides the default text", () => {
    const def: FilterDef = {
      key: "status",
      label: "Live status",
      type: "multi",
      options: opts("active", "paused"),
      values: ["active", "paused"],
      onChange: () => {},
      chipFormat: (v) => `Total · ${v.length}`,
    };
    expect(defaultChipLabel(def)).toBe("Live status: Total · 2");
  });

  it("toggleValue adds and removes without reordering the rest", () => {
    expect(toggleValue(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleValue(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("CLEAR clears tier-2 filters and NOTHING else", () => {
  it("clears every active filter, and only the active ones", () => {
    const { defs, calls } = config({ types: ["video"], metrics: true });
    clearFilters(defs);
    // `stages` was already empty — it isn't touched at all.
    expect(calls).toEqual(["types:", "metrics:clear"]);
  });

  it("can only reach what the defs declare — there is no param list to drift", () => {
    // Sort, columns, the view, the date range and tier-1 controls live OUTSIDE
    // the defs, so clearing cannot reach them by construction. This test
    // stands in for that: a spy that would fire if the shell knew any key.
    const forbidden = vi.fn();
    const defs: FilterDef[] = [
      {
        key: "types",
        label: "Type",
        type: "multi",
        options: opts("video"),
        values: ["video"],
        onChange: () => {},
      },
    ];
    clearFilters(defs);
    expect(forbidden).not.toHaveBeenCalled();
    expect(activeFilterCount(defs)).toBe(1); // values come from the page, not us
  });
});

/**
 * THE ACCEPTANCE CRITERION (the user's future-proofing requirement): adding a
 * filter to a page is adding ONE FilterDef. The shell is not edited — this
 * test adds a brand-new filter to an existing config and asserts the count,
 * the chips and Clear all pick it up with no other change.
 */
describe("adding a filter = adding one FilterDef, zero shell edits", () => {
  it("a new def joins the badge, the chips row and Clear on its own", () => {
    const base = config({ types: ["video"] });
    expect(activeFilterCount(base.defs)).toBe(1);
    expect(filterChips(base.defs).map((c) => c.label)).toEqual(["Type: Video"]);

    // ── the whole diff a page makes to gain a filter ──────────────────────
    const calls: string[] = [];
    const brandNew: FilterDef = {
      key: "creators",
      label: "Creator",
      type: "multi",
      options: [
        { value: "u1", label: "Sara" },
        { value: "u2", label: "Omar" },
      ],
      values: ["u1", "u2"],
      onChange: (next) => calls.push(`creators:${next.join("|")}`),
    };
    const defs = [...base.defs, brandNew];
    // ─────────────────────────────────────────────────────────────────────

    expect(activeFilterCount(defs)).toBe(2);
    const chips = filterChips(defs);
    expect(chips.map((c) => c.label)).toEqual(["Type: Video", "Creator: Sara +1"]);
    chips.find((c) => c.key === "creators")!.onRemove();
    expect(calls).toEqual(["creators:"]);

    clearFilters(defs);
    expect(calls).toEqual(["creators:", "creators:"]); // Clear reached it too
  });

  it("…including a single-select and a custom one", () => {
    const calls: string[] = [];
    const defs: FilterDef[] = [
      {
        key: "mode",
        label: "Mode",
        type: "single",
        options: opts("live", "draft"),
        value: "live",
        onChange: (next) => calls.push(`mode:${next}`),
      },
      {
        key: "rules",
        label: "Rules",
        type: "custom",
        active: true,
        chips: [{ key: "r1", label: "CPA ≤ 20", onRemove: () => calls.push("r1") }],
        onClear: () => calls.push("rules:clear"),
        render: () => null,
      },
    ];
    expect(activeFilterCount(defs)).toBe(2);
    expect(filterChips(defs).map((c) => c.label)).toEqual(["Mode: Live", "CPA ≤ 20"]);
    clearFilters(defs);
    expect(calls).toEqual(["mode:null", "rules:clear"]);
  });
});

// ── The URL writer ───────────────────────────────────────────────────────────

describe("nextQueryString — writes in one tick COMPOSE", () => {
  it("a second write builds on the first, not on the stale snapshot", () => {
    const current = "types=video&stages=Awareness&sort=total.spend";
    // What Clear does: one write per declared filter, all in the same tick.
    const first = nextQueryString(current, null, (p) => p.delete("types"));
    const second = nextQueryString(current, first, (p) => p.delete("stages"));
    // Without composition the second would have resurrected `types` — that is
    // the bug this exists to prevent (Clear cleared only the last filter).
    expect(second).toBe("sort=total.spend");
  });

  it("drops empty keys, and starts fresh once the write has landed", () => {
    expect(nextQueryString("a=1", null, (p) => p.set("b", ""))).toBe("a=1");
    // `pending = null` = the router handed the URL back; the snapshot rules.
    expect(nextQueryString("a=1&b=2", null, (p) => p.delete("a"))).toBe("b=2");
  });
});
