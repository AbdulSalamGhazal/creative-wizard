import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The batcher's only side effect is the server action; mocked so the pure
// parts (declaration allow-list, merge, debounce window) are what's tested.
vi.mock("@/app/actions/user-prefs", () => ({
  setFilterPrefs: vi.fn(async () => ({ ok: true })),
}));
import { setFilterPrefs } from "@/app/actions/user-prefs";
const setFilterPrefsMock = vi.mocked(setFilterPrefs);

import {
  FILTER_PREF_DEBOUNCE_MS,
  mergePrefEntries,
  queueFilterPrefs,
  setPersistedKeys,
  shouldPersistKey,
} from "@/lib/filter-prefs";
import {
  changedFilterEntries,
  effectiveQueryString,
  nextQueryString,
} from "@/components/filters/use-filter-params";
import {
  isPersistedDef,
  persistedFilterKeys,
} from "@/components/filters/filter-model";
import type { FilterDef } from "@/components/filters/filter-model";
import {
  NEVER_PERSIST_FILTER_KEYS,
  VIEW_MARKER_PARAM,
  isPersistableFilterKey,
  isSavedViewApplied,
} from "@/validators/user-prefs";

const opts = (...ids: string[]) => ids.map((id) => ({ value: id, label: id }));

describe("which filters are remembered", () => {
  it("counts a standard def and skips a custom one", () => {
    const defs: FilterDef[] = [
      {
        key: "stages",
        label: "Stage",
        type: "multi",
        options: opts("test"),
        values: [],
        onChange: () => {},
      },
      {
        key: "metricFilters",
        label: "Metrics",
        type: "custom",
        active: false,
        chips: [],
        onClear: () => {},
        render: () => null,
      },
    ];
    expect(defs.map(isPersistedDef)).toEqual([true, false]);
    expect(persistedFilterKeys(defs)).toEqual(["stages"]);
  });

  it("honours an explicit opt-out on a standard def", () => {
    const defs: FilterDef[] = [
      {
        key: "types",
        label: "Type",
        type: "multi",
        options: opts("image"),
        values: [],
        onChange: () => {},
        persist: false,
      },
    ];
    expect(persistedFilterKeys(defs)).toEqual([]);
  });

  it("writes only what the page declared — a view control is not a filter", () => {
    // Pacing rebuilds its whole query, so the writer sees `month`/`groupBy` too.
    setPersistedKeys(["platforms", "stages"]);
    expect(shouldPersistKey("platforms")).toBe(true);
    expect(shouldPersistKey("stages")).toBe(true);
    expect(shouldPersistKey("month")).toBe(false);
    expect(shouldPersistKey("groupBy")).toBe(false);
  });

  it("obeys the central deny-list even when a page declares the key", () => {
    setPersistedKeys([...NEVER_PERSIST_FILTER_KEYS]);
    for (const key of NEVER_PERSIST_FILTER_KEYS) {
      expect(shouldPersistKey(key)).toBe(false);
    }
    // The saved-view marker is on that list: a view is never a remembered filter.
    expect(isPersistableFilterKey(VIEW_MARKER_PARAM)).toBe(false);
  });
});

describe("isSavedViewApplied", () => {
  it("is true only with a non-empty marker", () => {
    const from = (qs: string) => {
      const p = new URLSearchParams(qs);
      return (key: string) => p.get(key) ?? undefined;
    };
    expect(isSavedViewApplied(from("platforms=meta"))).toBe(false);
    expect(isSavedViewApplied(from(`${VIEW_MARKER_PARAM}=`))).toBe(false);
    expect(
      isSavedViewApplied(from(`platforms=meta&${VIEW_MARKER_PARAM}=v1`)),
    ).toBe(true);
    // Library's own `view` (grid/table) must not read as a saved view.
    expect(isSavedViewApplied(from("view=table"))).toBe(false);
  });
});

describe("changedFilterEntries", () => {
  it("reads the value exactly as the URL holds it", () => {
    expect(changedFilterEntries("", "platforms=meta,tiktok")).toEqual([
      { key: "platforms", values: ["meta", "tiktok"] },
    ]);
    // A single compound value stays one value (Ads' rate filter).
    expect(changedFilterEntries("", "rate=total:good")).toEqual([
      { key: "rate", values: ["total:good"] },
    ]);
  });

  it("reports a removal as an empty set — the DELETE that stops resurrection", () => {
    expect(
      changedFilterEntries("platforms=meta&stages=test", "stages=test"),
    ).toEqual([{ key: "platforms", values: [] }]);
  });

  it("reports every key a Clear dropped, and nothing that stayed", () => {
    const changed = changedFilterEntries(
      "q=hat&platforms=meta&stages=test",
      "q=hat",
    );
    expect(changed.map((e) => e.key).sort()).toEqual(["platforms", "stages"]);
    expect(changed.every((e) => e.values.length === 0)).toBe(true);
  });

  it("ignores an unchanged param and a pure reorder", () => {
    expect(
      changedFilterEntries("platforms=meta&q=hat", "q=hat&platforms=meta"),
    ).toEqual([]);
  });
});

describe("the honesty rule: a remembered filter the URL doesn't carry", () => {
  // What the server resolved for this render — a preference, no URL param.
  const resolved = { platforms: "meta", stages: undefined };

  it("is part of the state the bar writes against", () => {
    expect(effectiveQueryString("q=hat", resolved)).toBe(
      "q=hat&platforms=meta",
    );
    // The URL still wins, and an unresolved key adds nothing.
    expect(effectiveQueryString("platforms=snapchat", resolved)).toBe(
      "platforms=snapchat",
    );
    expect(effectiveQueryString("", undefined)).toBe("");
  });

  it("is DELETED when its chip is removed, not resurrected", () => {
    // The chip's X deletes a param that was never in the URL…
    const before = effectiveQueryString("q=hat", resolved);
    const after = nextQueryString("q=hat", null, (p) => p.delete("platforms"));
    expect(after).toBe("q=hat"); // …so the URL doesn't change…
    // …and only the effective baseline can see the removal.
    expect(changedFilterEntries(before, after)).toEqual([
      { key: "platforms", values: [] },
    ]);
    expect(changedFilterEntries("q=hat", after)).toEqual([]);
  });

  it("is extended, not replaced, when another value is added", () => {
    const before = effectiveQueryString("", resolved);
    const after = nextQueryString("", null, (p) =>
      p.set("platforms", "meta,tiktok"),
    );
    expect(changedFilterEntries(before, after)).toEqual([
      { key: "platforms", values: ["meta", "tiktok"] },
    ]);
  });
});

describe("mergePrefEntries", () => {
  it("keeps one entry per key, last write winning", () => {
    expect(
      mergePrefEntries(
        [{ key: "platforms", values: ["meta"] }],
        [{ key: "platforms", values: ["meta", "tiktok"] }],
      ),
    ).toEqual([{ key: "platforms", values: ["meta", "tiktok"] }]);
  });

  it("lets a clear inside one burst survive the merge", () => {
    expect(
      mergePrefEntries(
        [{ key: "stages", values: ["test"] }],
        [{ key: "stages", values: [] }],
      ),
    ).toEqual([{ key: "stages", values: [] }]);
  });
});

describe("queueFilterPrefs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setFilterPrefsMock.mockClear();
    setPersistedKeys(["platforms", "stages"]);
  });
  afterEach(() => vi.useRealTimers());

  it("sends one write per burst, and nothing before the window closes", () => {
    queueFilterPrefs([{ key: "platforms", values: ["meta"] }]);
    queueFilterPrefs([{ key: "stages", values: ["test"] }]);
    queueFilterPrefs([{ key: "platforms", values: ["meta", "tiktok"] }]);
    expect(setFilterPrefsMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FILTER_PREF_DEBOUNCE_MS);
    expect(setFilterPrefsMock).toHaveBeenCalledTimes(1);
    expect(setFilterPrefsMock.mock.calls[0]![0]).toEqual({
      entries: [
        { key: "platforms", values: ["meta", "tiktok"] },
        { key: "stages", values: ["test"] },
      ],
    });
  });

  it("never talks to the server about an undeclared key", () => {
    queueFilterPrefs([
      { key: "q", values: ["hat"] },
      { key: "month", values: ["2026-09"] },
    ]);
    vi.advanceTimersByTime(FILTER_PREF_DEBOUNCE_MS);
    expect(setFilterPrefsMock).not.toHaveBeenCalled();
  });
});
