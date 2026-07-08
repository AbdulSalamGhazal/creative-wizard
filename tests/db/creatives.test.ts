import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { creativeDeletionSummary } from "@/db/queries/creatives";
import { resetAndSeed, CREATIVE_1, CREATIVE_B } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("creativeDeletionSummary()", () => {
  it("counts every record + campaign that would be deleted with the creative", async () => {
    const s = await creativeDeletionSummary(CREATIVE_1);
    expect(s.records).toBe(3); // 2 instagram + 1 facebook
    expect(s.campaigns).toBe(2); // camp1, camp2
    expect(s.platforms.find((p) => p.platform === "instagram")?.records).toBe(2);
    expect(s.platforms.find((p) => p.platform === "facebook")?.records).toBe(1);
    expect(s.firstDate).toBe("2026-01-01");
    expect(s.lastDate).toBe("2026-01-02"); // latest of c1's rows
  });

  it("account guard: a creative in ANOTHER account yields an empty summary", async () => {
    // Active account is A; CREATIVE_B belongs to account B → nothing to delete.
    const s = await creativeDeletionSummary(CREATIVE_B);
    expect(s.records).toBe(0);
    expect(s.platforms).toEqual([]);
    expect(s.campaigns).toBe(0);
  });
});
