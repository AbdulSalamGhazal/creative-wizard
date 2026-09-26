import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

// The active brand is a cookie in the app; here it's a knob, so brand scoping
// is testable from one process. `auth()` is the signed-in harness user.
let activeAccount = ACCOUNT_A;
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => activeAccount),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ id: "11111111-1111-1111-1111-111111111111" })),
  requireAuth: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
  })),
}));

import { db } from "@/lib/db";
import { userFilterPrefs, users } from "@/db/schema";
import { resolveFilterPrefs, writeFilterPrefs } from "@/db/queries/user-prefs";
import { PRODUCT_A, USER, resetAndSeed } from "./fixtures";
import { FILTERS_EXPLICIT_PARAM, VIEW_MARKER_PARAM } from "@/validators/user-prefs";

/** A page's raw-param reader, built from a URL query string. */
function raw(query: string) {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) ?? undefined;
}

async function rowFor(key: string, account = ACCOUNT_A) {
  const [row] = await db
    .select({ values: userFilterPrefs.values })
    .from(userFilterPrefs)
    .where(
      and(
        eq(userFilterPrefs.userId, USER),
        eq(userFilterPrefs.accountId, account),
        eq(userFilterPrefs.filterKey, key),
      ),
    );
  return row;
}

beforeAll(async () => {
  await resetAndSeed();
});

beforeEach(async () => {
  activeAccount = ACCOUNT_A;
  await db.delete(userFilterPrefs);
});

// Remembered filters (migration 0049): a filter the user set is re-applied on
// the next BARE visit to any page that has the same key — per user, per brand.

describe("resolveFilterPrefs", () => {
  it("gives the page nothing when the user has no preferences", async () => {
    const out = await resolveFilterPrefs([{ key: "platforms" }], raw(""));
    expect(out.platforms).toBeUndefined();
  });

  it("applies a remembered value to a bare URL, as the param string", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta", "tiktok"] },
    ]);
    const out = await resolveFilterPrefs([{ key: "platforms" }], raw(""));
    expect(out.platforms).toBe("meta,tiktok");
  });

  it("lets the URL win — the label never lies about what ran", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
    ]);
    const out = await resolveFilterPrefs(
      [{ key: "platforms" }],
      raw("platforms=snapchat"),
    );
    expect(out.platforms).toBe("snapchat");
  });

  it("resolves each key independently in ONE read", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
      { key: "stages", values: ["test"] },
    ]);
    const out = await resolveFilterPrefs(
      [{ key: "platforms" }, { key: "stages" }, { key: "types" }],
      raw("stages=scale"),
    );
    // URL · preference · page default, in one call.
    expect(out).toEqual({
      platforms: "meta",
      stages: "scale",
      types: undefined,
    });
  });

  it("drops a remembered id the page can no longer honour", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      {
        key: "productIds",
        values: [PRODUCT_A, "22222222-2222-2222-2222-22222222dead"],
      },
    ]);
    const kept = await resolveFilterPrefs(
      [{ key: "productIds", allow: [PRODUCT_A] }],
      raw(""),
    );
    expect(kept.productIds).toBe(PRODUCT_A);

    // Every remembered id gone → the page's own default, never an empty filter.
    const none = await resolveFilterPrefs(
      [{ key: "productIds", allow: [] }],
      raw(""),
    );
    expect(none.productIds).toBeUndefined();
  });

  it("never resolves a key the app forbids remembering", async () => {
    // Written straight to the table — the guard has to hold on READ too.
    await db.insert(userFilterPrefs).values({
      userId: USER,
      accountId: ACCOUNT_A,
      filterKey: "q",
      values: ["hat"],
    });
    const out = await resolveFilterPrefs([{ key: "q" }], raw(""));
    expect(out.q).toBeUndefined();
  });

  it("is per brand: a preference set on A leaves B alone", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
    ]);
    expect(
      (await resolveFilterPrefs([{ key: "platforms" }], raw(""))).platforms,
    ).toBe("meta");

    activeAccount = ACCOUNT_B;
    expect(
      (await resolveFilterPrefs([{ key: "platforms" }], raw(""))).platforms,
    ).toBeUndefined();

    await writeFilterPrefs(USER, ACCOUNT_B, [
      { key: "platforms", values: ["snapchat"] },
    ]);
    expect(
      (await resolveFilterPrefs([{ key: "platforms" }], raw(""))).platforms,
    ).toBe("snapchat");
    activeAccount = ACCOUNT_A;
    expect(
      (await resolveFilterPrefs([{ key: "platforms" }], raw(""))).platforms,
    ).toBe("meta");
  });

  it("SKIPS every preference while a saved view is applied", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
      { key: "stages", values: ["test"] },
    ]);
    const out = await resolveFilterPrefs(
      [{ key: "platforms" }, { key: "stages" }],
      raw(`stages=scale&${VIEW_MARKER_PARAM}=view-1`),
    );
    // The view owns the state: what it set stands, what it left out stays empty.
    expect(out).toEqual({ platforms: undefined, stages: "scale" });
  });

  it("SKIPS every preference on a URL that states its filters in full", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
      { key: "stages", values: ["test"] },
    ]);
    // The shell stamps `fx` on every filter change, having first written each
    // remembered value into the URL — so a filter the user just CLEARED must
    // not come back from its own preference before the write-through lands.
    const out = await resolveFilterPrefs(
      [{ key: "platforms" }, { key: "stages" }],
      raw(`platforms=meta&${FILTERS_EXPLICIT_PARAM}=1`),
    );
    expect(out).toEqual({ platforms: "meta", stages: undefined });
  });
});

describe("writeFilterPrefs", () => {
  it("upserts one row per key and overwrites the value", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
    ]);
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta", "tiktok"] },
    ]);
    const rows = await db
      .select({
        key: userFilterPrefs.filterKey,
        values: userFilterPrefs.values,
      })
      .from(userFilterPrefs);
    expect(rows).toEqual([{ key: "platforms", values: ["meta", "tiktok"] }]);
  });

  it("DELETES the row when the filter is cleared — no resurrection", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
      { key: "stages", values: ["test"] },
    ]);
    await writeFilterPrefs(USER, ACCOUNT_A, [{ key: "platforms", values: [] }]);

    expect(await rowFor("platforms")).toBeUndefined();
    expect(await rowFor("stages")).toEqual({ values: ["test"] });
    // A bare URL after the clear filters by nothing.
    const out = await resolveFilterPrefs([{ key: "platforms" }], raw(""));
    expect(out.platforms).toBeUndefined();
  });

  it("handles a Clear's deletes and a set in ONE call", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
      { key: "stages", values: ["test"] },
    ]);
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: [] },
      { key: "stages", values: [] },
      { key: "types", values: ["video"] },
    ]);
    const rows = await db
      .select({ key: userFilterPrefs.filterKey })
      .from(userFilterPrefs);
    expect(rows).toEqual([{ key: "types" }]);
  });

  it("keeps one row per (user, brand, key)", async () => {
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "platforms", values: ["meta"] },
    ]);
    await writeFilterPrefs(USER, ACCOUNT_B, [
      { key: "platforms", values: ["snapchat"] },
    ]);
    expect(await rowFor("platforms", ACCOUNT_A)).toEqual({ values: ["meta"] });
    expect(await rowFor("platforms", ACCOUNT_B)).toEqual({
      values: ["snapchat"],
    });
  });

  it("follows a deleted user out (FK CASCADE) — no orphan preferences", async () => {
    const OTHER = "11111111-1111-1111-1111-1111111111ff";
    await db
      .insert(users)
      .values({
        id: OTHER,
        email: "prefs@test.local",
        name: "Prefs",
        role: "editor",
      });
    await writeFilterPrefs(OTHER, ACCOUNT_A, [
      { key: "stages", values: ["test"] },
    ]);
    await writeFilterPrefs(USER, ACCOUNT_A, [
      { key: "stages", values: ["scale"] },
    ]);

    await db.delete(users).where(eq(users.id, OTHER));

    const rows = await db
      .select({ userId: userFilterPrefs.userId })
      .from(userFilterPrefs);
    expect(rows).toEqual([{ userId: USER }]);
  });
});
