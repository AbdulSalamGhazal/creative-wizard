import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

// Same harness as the filter prefs: the active brand is a knob (a cookie in
// the app), and the signed-in user is the fixtures' harness user.
let activeAccount = ACCOUNT_A;
let currentUser = "11111111-1111-1111-1111-111111111111";
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => activeAccount),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ id: currentUser })),
  requireAuth: vi.fn(async () => ({ id: currentUser })),
}));

import { db } from "@/lib/db";
import { userTablePrefs, users } from "@/db/schema";
import {
  deleteTablePref,
  resolveTablePrefs,
  writeTablePrefs,
} from "@/db/queries/user-prefs";
import { resetTableColumns, setTableColumns } from "@/app/actions/user-prefs";
import { TABLE_KEYS, resolveColumnPrefs } from "@/lib/table-columns";
import { USER, resetAndSeed } from "./fixtures";

const OTHER_USER = "11111111-1111-1111-1111-1111111111f1";

async function rowFor(tableKey: string, account = ACCOUNT_A, user = USER) {
  const [row] = await db
    .select({ hidden: userTablePrefs.hidden, order: userTablePrefs.colOrder })
    .from(userTablePrefs)
    .where(
      and(
        eq(userTablePrefs.userId, user),
        eq(userTablePrefs.accountId, account),
        eq(userTablePrefs.tableKey, tableKey),
      ),
    );
  return row;
}

beforeAll(async () => {
  await resetAndSeed();
  await db
    .insert(users)
    .values({
      id: OTHER_USER,
      email: "other@table-prefs.test",
      name: "Other",
      role: "editor",
    })
    .onConflictDoNothing();
});

beforeEach(async () => {
  activeAccount = ACCOUNT_A;
  currentUser = USER;
  await db.delete(userTablePrefs);
});

describe("writing and reading one table's columns", () => {
  it("round-trips hidden + order, and updates in place", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm"],
      order: ["spend", "roas"],
    });
    expect(await rowFor(TABLE_KEYS.CAMPAIGNS)).toEqual({
      hidden: ["cpm"],
      order: ["spend", "roas"],
    });

    // The unique key is (user, brand, table): a second write is an UPDATE.
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm", "cvr"],
      order: ["roas", "spend"],
    });
    expect(await rowFor(TABLE_KEYS.CAMPAIGNS)).toEqual({
      hidden: ["cpm", "cvr"],
      order: ["roas", "spend"],
    });
    expect(await db.select().from(userTablePrefs)).toHaveLength(1);
  });

  it("UPSERTS whatever it is given — the client decides what 'default' means", async () => {
    // Phase 2: some tables ship with columns hidden, so an EMPTY hidden set is
    // a real choice ("show me everything") that has to survive. The writer
    // therefore stores what it is told; `isDefaultColumnState` on the client
    // routes a default state to the DELETE instead (unit-pinned).
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.LIBRARY,
      hidden: ["notes"],
      order: [],
    });
    expect(await rowFor(TABLE_KEYS.LIBRARY)).toEqual({ hidden: ["notes"], order: [] });

    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.LIBRARY,
      hidden: [],
      order: [],
    });
    expect(await rowFor(TABLE_KEYS.LIBRARY)).toEqual({ hidden: [], order: [] });

    // …and the reset path is what removes it.
    await deleteTablePref(USER, ACCOUNT_A, TABLE_KEYS.LIBRARY);
    expect(await rowFor(TABLE_KEYS.LIBRARY)).toBeUndefined();
  });

  it("reset DELETES the row — the filters' cleared-row rule", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.STORE_ORDERS,
      hidden: ["utm_source"],
      order: [],
    });
    await deleteTablePref(USER, ACCOUNT_A, TABLE_KEYS.STORE_ORDERS);
    expect(await rowFor(TABLE_KEYS.STORE_ORDERS)).toBeUndefined();
  });
});

describe("scoping", () => {
  it("is per USER — one person's columns are invisible to another", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm"],
      order: [],
    });
    const mine = await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]);
    expect(mine[TABLE_KEYS.CAMPAIGNS]?.hidden).toEqual(["cpm"]);

    currentUser = OTHER_USER;
    const theirs = await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]);
    expect(theirs[TABLE_KEYS.CAMPAIGNS]).toEqual({ hidden: [], order: [] });
  });

  it("is per BRAND — switching brands shows that brand's choice", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm"],
      order: [],
    });
    await writeTablePrefs(USER, ACCOUNT_B, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["roas", "aov"],
      order: [],
    });
    expect((await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]))[TABLE_KEYS.CAMPAIGNS]).toEqual({
      hidden: ["cpm"],
      order: [],
    });
    activeAccount = ACCOUNT_B;
    expect((await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]))[TABLE_KEYS.CAMPAIGNS]).toEqual({
      hidden: ["roas", "aov"],
      order: [],
    });
  });

  it("resolves several tables in ONE read, defaulting the ones with no row", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm"],
      order: [],
    });
    const out = await resolveTablePrefs([
      TABLE_KEYS.CAMPAIGNS,
      TABLE_KEYS.STORE_ORDERS,
      TABLE_KEYS.CAMPAIGN_RECORDS,
    ]);
    expect(out[TABLE_KEYS.CAMPAIGNS]?.hidden).toEqual(["cpm"]);
    expect(out[TABLE_KEYS.STORE_ORDERS]).toEqual({ hidden: [], order: [] });
    expect(out[TABLE_KEYS.CAMPAIGN_RECORDS]).toEqual({ hidden: [], order: [] });
  });
});

describe("the action is the boundary", () => {
  it("refuses a table key nobody declared — no junk rows", async () => {
    const res = await setTableColumns({
      tableKey: "not-a-table",
      hidden: ["x"],
      order: [],
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(userTablePrefs)).toHaveLength(0);

    const reset = await resetTableColumns({ tableKey: "not-a-table" });
    expect(reset.ok).toBe(false);
  });

  it("writes as the SESSION user and the active brand, not as whoever asks", async () => {
    // There is no user id in the input by design — the action's subject is the
    // signed-in session, so one user cannot write another's preference.
    const res = await setTableColumns({
      tableKey: TABLE_KEYS.STORE_ORDERS,
      hidden: ["channel"],
      order: [],
    });
    expect(res.ok).toBe(true);
    expect(await rowFor(TABLE_KEYS.STORE_ORDERS, ACCOUNT_A, USER)).toEqual({
      hidden: ["channel"],
      order: [],
    });

    currentUser = OTHER_USER;
    activeAccount = ACCOUNT_B;
    await setTableColumns({
      tableKey: TABLE_KEYS.STORE_ORDERS,
      hidden: ["city"],
      order: [],
    });
    // Two rows, each scoped to its own (user, brand) — neither touched the other.
    expect(await db.select().from(userTablePrefs)).toHaveLength(2);
    expect(await rowFor(TABLE_KEYS.STORE_ORDERS, ACCOUNT_A, USER)).toEqual({
      hidden: ["channel"],
      order: [],
    });
  });

  it("refuses junk shapes without throwing", async () => {
    expect((await setTableColumns(null)).ok).toBe(false);
    expect((await setTableColumns({ tableKey: TABLE_KEYS.CAMPAIGNS })).ok).toBe(false);
    expect(
      (await setTableColumns({ tableKey: TABLE_KEYS.CAMPAIGNS, hidden: "cpm", order: [] }))
        .ok,
    ).toBe(false);
  });
});

describe("precedence, against a real stored preference", () => {
  const DEFAULTS = ["spend", "roas", "cpm", "cvr"];

  it("URL → applied view → preference → default, end to end", async () => {
    await writeTablePrefs(USER, ACCOUNT_A, {
      tableKey: TABLE_KEYS.CAMPAIGNS,
      hidden: ["cpm"],
      order: ["roas", "spend", "cpm", "cvr"],
    });
    const pref = (await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]))[TABLE_KEYS.CAMPAIGNS];

    // A bare URL takes the preference…
    expect(
      resolveColumnPrefs({ url: {}, pref, hideable: DEFAULTS, defaults: DEFAULTS }),
    ).toEqual({ hidden: ["cpm"], order: ["roas", "spend", "cpm", "cvr"] });

    // …a saved view suppresses it entirely…
    expect(
      resolveColumnPrefs({
        url: {},
        viewApplied: true,
        pref,
        hideable: DEFAULTS,
        defaults: DEFAULTS,
      }),
    ).toEqual({ hidden: [], order: [] });

    // …and the URL wins over both.
    expect(
      resolveColumnPrefs({
        url: { hidden: ["cvr"] },
        pref,
        hideable: DEFAULTS,
        defaults: DEFAULTS,
      }).hidden,
    ).toEqual(["cvr"]);
  });
});
