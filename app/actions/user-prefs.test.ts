import { beforeEach, describe, expect, it, vi } from "vitest";

// Pure-unit: mock the db, auth, and revalidation so the action's own logic
// (input guard → write shape) is what's under test.
const setMock = vi.fn().mockReturnThis();
const whereMock = vi.fn().mockResolvedValue(undefined);
// Accepts (and ignores) the table argument drizzle passes.
const updateMock = vi.fn((...args: unknown[]) => {
  void args;
  return { set: setMock, where: whereMock };
});
vi.mock("@/lib/db", () => ({ db: { update: (t: unknown) => updateMock(t) } }));
// The filter-preference writer is DB-tested against a real Postgres
// (tests/db/filter-prefs.test.ts); here the action's own guard is what matters.
const writeFilterPrefsMock = vi.fn(async () => {});
vi.mock("@/db/queries/user-prefs", () => ({
  writeFilterPrefs: (...args: unknown[]) => writeFilterPrefsMock(...(args as [])),
}));
vi.mock("@/lib/tenant", () => ({
  getActiveAccountId: vi.fn(async () => "acct-1"),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setFilterPrefs, setIncludeExcludedPref } from "@/app/actions/user-prefs";

beforeEach(() => {
  updateMock.mockClear();
  setMock.mockClear();
  setMock.mockReturnValue({ where: whereMock });
});

describe("setIncludeExcludedPref", () => {
  it("persists a boolean choice as the user's preference", async () => {
    await setIncludeExcludedPref(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ includeExcluded: true });

    await setIncludeExcludedPref(false);
    expect(setMock).toHaveBeenCalledWith({ includeExcluded: false });
  });

  it("rejects non-boolean input without writing", async () => {
    // A server action can be invoked with arbitrary payloads.
    await setIncludeExcludedPref("1" as unknown as boolean);
    await setIncludeExcludedPref(1 as unknown as boolean);
    await setIncludeExcludedPref(undefined as unknown as boolean);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("setFilterPrefs", () => {
  beforeEach(() => writeFilterPrefsMock.mockClear());

  it("writes the burst, scoped to the caller and their active brand", async () => {
    const entries = [
      { key: "platforms", values: ["meta", "tiktok"] },
      { key: "stages", values: [] },
    ];
    expect(await setFilterPrefs({ entries })).toEqual({ ok: true });
    expect(writeFilterPrefsMock).toHaveBeenCalledWith("user-1", "acct-1", entries);
  });

  it("refuses a key the app never remembers — the guard is server-side too", async () => {
    // A server action can be invoked with arbitrary payloads.
    expect(await setFilterPrefs({ entries: [{ key: "q", values: ["hat"] }] })).toEqual({
      ok: false,
    });
    expect(await setFilterPrefs({ entries: [{ key: "sv", values: ["v1"] }] })).toEqual({
      ok: false,
    });
    expect(writeFilterPrefsMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed or oversized payload without writing", async () => {
    for (const bad of [
      undefined,
      "platforms=meta",
      { entries: [] },
      { entries: [{ key: "platforms", values: "meta" }] },
      { entries: [{ key: "platforms", values: [""] }] },
      { entries: Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, values: ["x"] })) },
      { entries: [{ key: "platforms", values: Array.from({ length: 51 }, () => "x") }] },
    ]) {
      expect(await setFilterPrefs(bad)).toEqual({ ok: false });
    }
    expect(writeFilterPrefsMock).not.toHaveBeenCalled();
  });
});
