import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The batcher's only side effect is the server action; mocked so the pure
// parts (merge, debounce window, reset routing) are what's tested.
vi.mock("@/app/actions/user-prefs", () => ({
  setTableColumns: vi.fn(async () => ({ ok: true })),
  resetTableColumns: vi.fn(async () => ({ ok: true })),
}));
import { resetTableColumns, setTableColumns } from "@/app/actions/user-prefs";
const setMock = vi.mocked(setTableColumns);
const resetMock = vi.mocked(resetTableColumns);

import {
  TABLE_PREF_DEBOUNCE_MS,
  mergeTableEntries,
  queueTablePrefs,
} from "@/lib/table-prefs";
import { TABLE_KEYS } from "@/lib/table-columns";

beforeEach(() => {
  vi.useFakeTimers();
  setMock.mockClear();
  resetMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("merging a burst", () => {
  it("keeps ONE entry per table, last write winning", () => {
    const merged = mergeTableEntries(
      [{ tableKey: "campaigns", hidden: ["a"], order: [] }],
      [
        { tableKey: "campaigns", hidden: ["a", "b"], order: [] },
        { tableKey: "store-orders", hidden: [], order: ["x"] },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.tableKey === "campaigns")?.hidden).toEqual(["a", "b"]);
  });

  it("lets a RESET win over an earlier toggle in the same burst", () => {
    const merged = mergeTableEntries(
      [{ tableKey: "campaigns", hidden: ["a"], order: [] }],
      [{ tableKey: "campaigns", hidden: [], order: [], reset: true }],
    );
    expect(merged).toEqual([
      { tableKey: "campaigns", hidden: [], order: [], reset: true },
    ]);
  });
});

describe("the queue", () => {
  it("hiding four columns in a row is ONE write", () => {
    for (const hidden of [["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]) {
      queueTablePrefs({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden, order: [] });
    }
    expect(setMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["a", "b", "c", "d"],
      order: [],
    });
  });

  it("routes a reset to the DELETE action, not to a write of empties", () => {
    queueTablePrefs({
      tableKey: TABLE_KEYS.STORE_ORDERS,
      hidden: [],
      order: [],
      reset: true,
    });
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS);
    expect(resetMock).toHaveBeenCalledWith({ tableKey: TABLE_KEYS.STORE_ORDERS });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("writes two different tables in the same burst, once each", () => {
    queueTablePrefs({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden: ["a"], order: [] });
    queueTablePrefs({ tableKey: TABLE_KEYS.STORE_ORDERS, hidden: ["z"], order: [] });
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS);
    expect(setMock).toHaveBeenCalledTimes(2);
  });
});
