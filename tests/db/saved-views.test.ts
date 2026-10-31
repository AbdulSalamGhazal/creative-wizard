import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * Saved views are PRIVATE to their owner and scoped to the active brand
 * (app/actions/summary-view.ts, db/queries/summary-views.ts). Through the real
 * actions: a teammate's views never list for you, a non-owner can't delete or
 * re-default yours, one owner's default never clears another's, and a view in
 * brand B is unreachable from brand A.
 */
const OWNER = "11111111-1111-1111-1111-111111111111"; // the fixtures' admin
const TEAMMATE = "11111111-1111-1111-1111-1111111111e2";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: OWNER, role: "admin" })),
  requirePermission: vi.fn(async () => ({ id: OWNER, role: "admin" })),
  auth: vi.fn(async () => ({ id: OWNER, role: "admin" })),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth, type SessionUser } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { summaryViews, users } from "@/db/schema";
import { createSummaryView, deleteSummaryView, setDefaultView } from "@/app/actions/summary-view";
import { getDefaultSummaryView, listSummaryViews } from "@/db/queries/summary-views";
import { resetAndSeed } from "./fixtures";

const session = (id: string, role: SessionUser["role"]): SessionUser => ({
  id, email: `${id}@test.local`, name: role, role, permissions: null, allAccounts: true, avatarUrl: null,
});
const ADMIN = session(OWNER, "admin");
const EDITOR = session(TEAMMATE, "editor");
const actAs = (u: SessionUser) => vi.mocked(requireAuth).mockResolvedValue(u);
const inBrand = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const save = async (name: string, page = "summary", query = "range=last_7") => {
  const res = await createSummaryView({ name, query, page });
  expect(res.ok).toBe(true);
  return res.id!;
};
const exists = async (id: string) =>
  (await db.select({ id: summaryViews.id }).from(summaryViews).where(eq(summaryViews.id, id))).length === 1;
const isDefault = async (id: string) =>
  (await db.select({ d: summaryViews.isDefault }).from(summaryViews).where(eq(summaryViews.id, id)))[0]!.d;

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values({ id: TEAMMATE, email: "teammate@test.local", name: "Teammate", role: "editor" });
  inBrand(ACCOUNT_A);
  actAs(ADMIN);
});

describe("saved views — private to the owner", () => {
  it("a teammate's views never list for you, on the same page and brand", async () => {
    await save("Mine");
    actAs(EDITOR);
    await save("Theirs");

    expect((await listSummaryViews(OWNER)).map((v) => v.name)).toEqual(["Mine"]);
    expect((await listSummaryViews(TEAMMATE)).map((v) => v.name)).toEqual(["Theirs"]);
  });

  it("a name is unique per owner and page — a teammate may reuse it", async () => {
    await save("Weekly");
    expect(await createSummaryView({ name: "Weekly", query: "", page: "summary" })).toEqual({
      ok: false,
      error: "You already have a view with that name.",
    });
    await save("Weekly", "campaigns"); // another page: allowed
    actAs(EDITOR);
    await save("Weekly"); // another owner: allowed
  });

  it("a non-owner below admin can't delete or re-default your view", async () => {
    const id = await save("Mine");
    actAs(EDITOR);
    expect((await deleteSummaryView(id)).ok).toBe(false);
    expect((await setDefaultView(id)).ok).toBe(false);
    expect(await exists(id)).toBe(true);
    expect(await isDefault(id)).toBe(false);
  });

  it("an admin may delete a teammate's view", async () => {
    actAs(EDITOR);
    const id = await save("Theirs");
    actAs(ADMIN);
    expect(await deleteSummaryView(id)).toEqual({ ok: true });
    expect(await exists(id)).toBe(false);
  });
});

describe("saved views — the default", () => {
  it("one default per owner and page; re-defaulting moves it, a second call clears it", async () => {
    const a = await save("A");
    const b = await save("B");
    await setDefaultView(a);
    await setDefaultView(b);
    expect([await isDefault(a), await isDefault(b)]).toEqual([false, true]);
    expect((await getDefaultSummaryView(OWNER))?.id).toBe(b);

    await setDefaultView(b);
    expect(await isDefault(b)).toBe(false);
    expect(await getDefaultSummaryView(OWNER)).toBeNull();
  });

  it("setting your default never clears a teammate's", async () => {
    actAs(EDITOR);
    const theirs = await save("Theirs");
    await setDefaultView(theirs);
    actAs(ADMIN);
    const mine = await save("Mine");
    await setDefaultView(mine);

    expect(await isDefault(theirs)).toBe(true);
    expect(await isDefault(mine)).toBe(true);
    expect((await getDefaultSummaryView(TEAMMATE))?.id).toBe(theirs);
  });
});

describe("saved views — brand isolation", () => {
  it("a view saved in brand B is invisible and untouchable from brand A", async () => {
    inBrand(ACCOUNT_B);
    const inB = await save("B view");
    await setDefaultView(inB);

    inBrand(ACCOUNT_A);
    expect(await listSummaryViews(OWNER)).toEqual([]);
    expect(await getDefaultSummaryView(OWNER)).toBeNull();
    expect(await deleteSummaryView(inB)).toEqual({ ok: false, error: "View not found." });
    expect(await setDefaultView(inB)).toEqual({ ok: false, error: "View not found." });
    expect(await exists(inB)).toBe(true);
    expect(await isDefault(inB)).toBe(true);
  });

  it("the same name may exist once per brand for one owner", async () => {
    await save("Weekly");
    inBrand(ACCOUNT_B);
    await save("Weekly");
    expect((await listSummaryViews(OWNER)).map((v) => v.name)).toEqual(["Weekly"]);
  });
});
