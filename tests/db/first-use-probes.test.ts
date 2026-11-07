import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/** A brand the fixtures never seed — nothing belongs to it. */
const EMPTY_BRAND = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const active = vi.hoisted(() => ({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }));
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => active.id),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { brandHasAdData } from "@/db/queries/creative-status";
import { brandHasCreatives } from "@/db/queries/creatives";
import { brandHasStoreOrders } from "@/db/queries/store";
import { resetAndSeed } from "./fixtures";

/**
 * The first-use probes (R-003, R-018, R-059): each asks about the BRAND, so a
 * seeded brand answers yes and a brand with nothing answers no — never a
 * neighbour's rows.
 */
describe("first-use probes", () => {
  beforeEach(async () => {
    active.id = ACCOUNT_A;
    await resetAndSeed();
  });

  it("see the active brand's data", async () => {
    expect(await brandHasAdData()).toBe(true);
    expect(await brandHasCreatives()).toBe(true);
  });

  it("answer no for a brand with nothing", async () => {
    active.id = EMPTY_BRAND;
    expect(await brandHasAdData()).toBe(false);
    expect(await brandHasCreatives()).toBe(false);
    expect(await brandHasStoreOrders()).toBe(false);
  });
});
