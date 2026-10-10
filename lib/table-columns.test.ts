import { describe, expect, it } from "vitest";
import {
  TABLE_KEYS,
  TABLE_KEY_LIST,
  isDefaultColumnState,
  isTableKey,
  mergeColumnOrder,
  mergeHiddenColumns,
  moveColumn,
  parseColumnList,
  resolveColumnPrefs,
} from "@/lib/table-columns";

/**
 * The pure half of the unified columns system. These rules are what keep a
 * SAVED choice honest against a config that keeps changing — the stored arrays
 * outlive any particular column set, so every one of them is a merge, not an
 * assignment.
 */

const DEFAULTS = ["a", "b", "c", "d"];

describe("the table registry", () => {
  it("is derived, and refuses a key nobody declared", () => {
    expect(TABLE_KEY_LIST).toEqual(Object.values(TABLE_KEYS));
    expect(new Set(TABLE_KEY_LIST).size).toBe(TABLE_KEY_LIST.length);
    for (const key of TABLE_KEY_LIST) expect(isTableKey(key)).toBe(true);
    expect(isTableKey("campaigns-v2")).toBe(false);
    expect(isTableKey("")).toBe(false);
  });
});

describe("mergeColumnOrder", () => {
  it("keeps a saved order as it stands when nothing changed", () => {
    expect(mergeColumnOrder(["c", "a", "b", "d"], DEFAULTS)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("drops keys that no longer exist", () => {
    expect(mergeColumnOrder(["c", "gone", "a", "b", "d"], DEFAULTS)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("puts a NEW column at its default position, not at the end", () => {
    // "b" is new to this save; the config puts it after "a", so that is where
    // it lands — appending it would bury every new column for anyone who had
    // ever reordered the table.
    expect(mergeColumnOrder(["c", "a", "d"], DEFAULTS)).toEqual(["c", "a", "b", "d"]);
  });

  it("puts a new FIRST column at the front", () => {
    expect(mergeColumnOrder(["b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("anchors a new column to its preceding neighbour, or the front", () => {
    // Each new key goes after the nearest EARLIER config key that survived the
    // merge. With "d" the only saved key, a/b/c have no surviving predecessor,
    // so they keep their config order ahead of it — the shape a save written
    // before three columns existed should read as.
    expect(mergeColumnOrder(["d"], DEFAULTS)).toEqual(["a", "b", "c", "d"]);
    // With a predecessor present, the new key lands right after it.
    expect(mergeColumnOrder(["a", "d"], DEFAULTS)).toEqual(["a", "b", "c", "d"]);
    expect(mergeColumnOrder(["d", "a"], DEFAULTS)).toEqual(["d", "a", "b", "c"]);
  });

  it("collapses duplicates and survives an empty save", () => {
    expect(mergeColumnOrder(["a", "a", "b"], DEFAULTS)).toEqual(["a", "b", "c", "d"]);
    expect(mergeColumnOrder([], DEFAULTS)).toEqual(DEFAULTS);
  });
});

describe("mergeHiddenColumns", () => {
  it("is a HIDDEN set — absent means visible", () => {
    // The whole reason the stored shape is "what's off": a column added later
    // is in nobody's saved set, so it shows up for everyone.
    expect(mergeHiddenColumns(["b"], DEFAULTS)).toEqual(["b"]);
    expect(mergeHiddenColumns([], DEFAULTS)).toEqual([]);
  });

  it("drops unknown keys and duplicates", () => {
    expect(mergeHiddenColumns(["b", "gone", "b"], DEFAULTS)).toEqual(["b"]);
  });
});

describe("the precedence rule: URL → view → preference → default", () => {
  const pref = { hidden: ["b"], order: ["d", "a", "b", "c"] };

  it("takes the URL when it states columns", () => {
    const res = resolveColumnPrefs({
      url: { hidden: ["c"], order: ["c", "a", "b", "d"] },
      pref,
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(res).toEqual({ hidden: ["c"], order: ["c", "a", "b", "d"] });
  });

  it("ignores the preference entirely while a saved view is applied", () => {
    // A view owns its URL, including the columns it leaves out — the same `sv`
    // suppression the remembered filters use, not a second mechanism.
    const res = resolveColumnPrefs({
      url: {},
      viewApplied: true,
      pref,
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(res).toEqual({ hidden: [], order: [] });
  });

  it("falls through to the preference on a bare URL", () => {
    const res = resolveColumnPrefs({ url: {}, pref, hideable: DEFAULTS, defaults: DEFAULTS });
    expect(res).toEqual({ hidden: ["b"], order: ["d", "a", "b", "c"] });
  });

  it("merges a stale preference against today's columns", () => {
    const stale = { hidden: ["b", "retired"], order: ["d", "retired", "a"] };
    const res = resolveColumnPrefs({
      url: {},
      pref: stale,
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(res.hidden).toEqual(["b"]);
    expect(res.order).toEqual(["d", "a", "b", "c"]);
  });

  it("falls through to the config when there is no preference at all", () => {
    expect(
      resolveColumnPrefs({ url: {}, pref: null, hideable: DEFAULTS, defaults: DEFAULTS }),
    ).toEqual({ hidden: [], order: [] });
  });

  it("takes a URL ORDER even when the URL hides nothing", () => {
    const res = resolveColumnPrefs({
      url: { order: ["d", "c", "b", "a"] },
      pref,
      hideable: DEFAULTS,
      defaults: DEFAULTS,
    });
    expect(res.order).toEqual(["d", "c", "b", "a"]);
    // …and the hidden half still comes from the preference: each half answers
    // its own question, so a reorder doesn't silently unhide a column.
    expect(res.hidden).toEqual(["b"]);
  });
});

describe("moveColumn", () => {
  it("moves one step and clamps at both ends", () => {
    expect(moveColumn(DEFAULTS, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveColumn(DEFAULTS, "c", 1)).toEqual(["a", "b", "d", "c"]);
    expect(moveColumn(DEFAULTS, "a", -1)).toEqual(DEFAULTS);
    expect(moveColumn(DEFAULTS, "d", 1)).toEqual(DEFAULTS);
  });

  it("handles a multi-step move (a drag across rows) and an unknown key", () => {
    expect(moveColumn(DEFAULTS, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveColumn(DEFAULTS, "nope", 1)).toEqual(DEFAULTS);
  });
});

describe("parseColumnList", () => {
  it("reads a URL list and ignores the empty cases", () => {
    expect(parseColumnList("a,b , c")).toEqual(["a", "b", "c"]);
    expect(parseColumnList("")).toEqual([]);
    expect(parseColumnList(null)).toEqual([]);
    expect(parseColumnList(undefined)).toEqual([]);
  });
});

describe("the default-state rule (phase 2)", () => {
  // Some tables ship with a collapsed tail, so "nothing hidden" is a real
  // choice there and must be STORED; matching the table's own default is what
  // deletes the row.
  it("matches an empty default", () => {
    expect(isDefaultColumnState({ hidden: [], order: [] })).toBe(true);
    expect(isDefaultColumnState({ hidden: ["a"], order: [] })).toBe(false);
    expect(isDefaultColumnState({ hidden: [], order: ["b", "a"] })).toBe(false);
  });

  it("matches a NON-empty default, regardless of order", () => {
    const def = ["notes", "createdAt"];
    expect(isDefaultColumnState({ hidden: ["createdAt", "notes"], order: [] }, def)).toBe(
      true,
    );
    // Showing everything is NOT the default for such a table — it is stored.
    expect(isDefaultColumnState({ hidden: [], order: [] }, def)).toBe(false);
    expect(isDefaultColumnState({ hidden: ["notes"], order: [] }, def)).toBe(false);
    expect(
      isDefaultColumnState({ hidden: ["notes", "createdAt", "x"], order: [] }, def),
    ).toBe(false);
  });
});

describe("the phase-2 registry", () => {
  it("covers every table the sweep wired, with stable keys", () => {
    // The keys are STORED, so renaming one orphans every row that carries it.
    expect([...TABLE_KEY_LIST].sort()).toEqual(
      [
        "ads-summary",
        "budget-allocation",
        "budget-audience",
        "budget-pacing",
        "budget-tracker",
        "campaign-creatives",
        "campaign-records",
        "campaigns",
        "creative-campaigns",
        "library",
        "recon-channels",
        "recon-platforms",
        "store-insights",
        "store-orders",
        "trends-angles",
        "trends-video",
      ].sort(),
    );
  });
});
