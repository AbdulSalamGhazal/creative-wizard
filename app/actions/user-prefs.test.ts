import { beforeEach, describe, expect, it, vi } from "vitest";

// Pure-unit: mock the db, auth, and revalidation so the action's own logic
// (input guard → write shape) is what's under test.
const setMock = vi.fn().mockReturnThis();
const whereMock = vi.fn().mockResolvedValue(undefined);
const updateMock = vi.fn((_table: unknown) => ({ set: setMock, where: whereMock }));
vi.mock("@/lib/db", () => ({ db: { update: (t: unknown) => updateMock(t) } }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setIncludeExcludedPref } from "@/app/actions/user-prefs";

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
