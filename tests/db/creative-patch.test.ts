import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// The action is the unit under test, so only the auth boundary is faked —
// validation, the transaction and the write all run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { patchCreative } from "@/app/actions/creative";
import { getCreativeByName } from "@/db/queries/creatives";
import { resetAndSeed, CREATIVE_1 } from "./fixtures";

const NAME = "A-Creative-1"; // CREATIVE_1 in the fixtures

beforeEach(async () => {
  await resetAndSeed();
});

/**
 * Regression (2026-09): the patch schema's "something to update?" refine was a
 * hand-written field list that never included `stages`, so changing ONLY the
 * stage on the detail page failed with "No fields to update." The refine is
 * derived from the schema's keys now.
 */
describe("patchCreative — a single field alone", () => {
  it("persists a STAGES-ONLY patch (the bug), read back via the detail query", async () => {
    const res = await patchCreative({ id: CREATIVE_1, stages: ["Retargeting", "Awareness"] });
    expect(res.ok).toBe(true);

    const detail = await getCreativeByName(NAME);
    // Stored in funnel order, whatever order they were sent in.
    expect(detail?.stages).toEqual(["Awareness", "Retargeting"]);
  });

  it("clearing stages alone ([] = unassigned) persists too", async () => {
    await patchCreative({ id: CREATIVE_1, stages: ["Activation"] });
    const res = await patchCreative({ id: CREATIVE_1, stages: [] });
    expect(res.ok).toBe(true);
    expect((await getCreativeByName(NAME))?.stages).toEqual([]);
  });

  it("a stages-only patch leaves every other field alone", async () => {
    const before = await getCreativeByName(NAME);
    await patchCreative({ id: CREATIVE_1, stages: ["Activation"] });
    const after = await getCreativeByName(NAME);
    expect(after?.name).toBe(before?.name);
    expect(after?.type).toBe(before?.type);
    expect(after?.priority).toBe(before?.priority);
  });

  it("still refuses a patch with nothing in it", async () => {
    const res = await patchCreative({ id: CREATIVE_1 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("No fields to update.");
  });
});
