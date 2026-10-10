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
  resetTablePrefsNow,
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

  it("leaves other tables alone", () => {
    const merged = mergeTableEntries(
      [{ tableKey: "campaigns", hidden: ["a"], order: [] }],
      [{ tableKey: "store-orders", hidden: ["z"], order: [] }],
    );
    expect(merged.map((e) => e.tableKey).sort()).toEqual(["campaigns", "store-orders"]);
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

  it("a reset DELETES, and is awaited rather than debounced", async () => {
    // The caller can wait on it, which is the whole point: on a URL-backed
    // table the navigation that follows must not race the delete.
    await resetTablePrefsNow(TABLE_KEYS.STORE_ORDERS);
    expect(resetMock).toHaveBeenCalledWith({ tableKey: TABLE_KEYS.STORE_ORDERS });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("a reset CANCELS a queued write for that table — no resurrection", async () => {
    // The sharp case: hide a column, then reset within the debounce window.
    // If the queued write survived, it would land AFTER the delete and
    // recreate the row the user just cleared.
    queueTablePrefs({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden: ["cpm"], order: [] });
    await resetTablePrefsNow(TABLE_KEYS.CAMPAIGNS);
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS * 3);
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("a reset leaves ANOTHER table's queued write alone", async () => {
    queueTablePrefs({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden: ["cpm"], order: [] });
    queueTablePrefs({ tableKey: TABLE_KEYS.STORE_ORDERS, hidden: ["city"], order: [] });
    await resetTablePrefsNow(TABLE_KEYS.CAMPAIGNS);
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS);
    expect(resetMock).toHaveBeenCalledWith({ tableKey: TABLE_KEYS.CAMPAIGNS });
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({
      tableKey: TABLE_KEYS.STORE_ORDERS,
      hidden: ["city"],
      order: [],
    });
  });

  it("writes two different tables in the same burst, once each", () => {
    queueTablePrefs({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden: ["a"], order: [] });
    queueTablePrefs({ tableKey: TABLE_KEYS.STORE_ORDERS, hidden: ["z"], order: [] });
    vi.advanceTimersByTime(TABLE_PREF_DEBOUNCE_MS);
    expect(setMock).toHaveBeenCalledTimes(2);
  });
});
