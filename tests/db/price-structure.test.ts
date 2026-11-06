import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

let activeAccount = ACCOUNT_A;
const USER_ID = "11111111-1111-1111-1111-111111111111";
/** The member's grants: "all" (an admin) or an explicit set. */
let grants: "all" | Set<string> = "all";
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => activeAccount),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER_ID, role: "admin" })),
  requireAuth: vi.fn(async () => ({ id: USER_ID, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER_ID, role: "admin" })),
  can: vi.fn((_user: unknown, perm: string) => grants === "all" || grants.has(perm)),
}));

import { db } from "@/lib/db";
import { psUserState, psVersions } from "@/db/schema";
import {
  getLastVersionId,
  getVersion,
  insertVersion,
  listVersions,
  pollVersions,
  touchVersionOpened,
  updateVersionIfRevision,
} from "@/db/queries/price-structure";
import {
  bootstrapVersion,
  createVersion,
  deleteVersion,
  openVersion,
  pollVersions as pollVersionsAction,
  saveVersion,
} from "@/app/actions/price-structure";
import { blankVersionData, sampleVersionData } from "@/price-structure/engine/sample";
import { toExport } from "@/price-structure/engine/export-import";
import { resetAndSeed } from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
});

beforeEach(async () => {
  activeAccount = ACCOUNT_A;
  grants = "all";
  await db.delete(psUserState);
  await db.delete(psVersions);
});

describe("versions are brand-scoped", () => {
  it("Account B's versions never appear for Account A, and B cannot read A's", async () => {
    const a = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "A", notes: "", data: blankVersionData() });
    await insertVersion(db, ACCOUNT_B, USER_ID, { name: "B", notes: "", data: blankVersionData() });
    expect((await listVersions(ACCOUNT_A)).map((v) => v.name)).toEqual(["A"]);
    expect(await getVersion(ACCOUNT_B, a.id)).toBeNull();
    activeAccount = ACCOUNT_B;
    const res = await deleteVersion({ id: a.id });
    expect(res.ok).toBe(false);
    expect(await getVersion(ACCOUNT_A, a.id)).not.toBeNull();
  });
});

describe("optimistic concurrency", () => {
  it("a save with the live revision goes through and bumps it", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: blankVersionData() });
    expect(v.revision).toBe(1);
    const data = { ...v.data, settings: { ...v.data.settings, deliveryRate: 0.9 } };
    const res = await saveVersion({ id: v.id, revision: 1, name: "Main", notes: "n", data });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(2);
    const row = await getVersion(ACCOUNT_A, v.id);
    expect(row?.data.settings.deliveryRate).toBe(0.9);
    expect(row?.notes).toBe("n");
  });

  it("a save on a stale revision is refused and hands back the live row", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: blankVersionData() });
    const first = await saveVersion({ id: v.id, revision: 1, name: "Tab 1", notes: "", data: v.data });
    expect(first.ok).toBe(true);
    const second = await saveVersion({ id: v.id, revision: 1, name: "Tab 2", notes: "", data: v.data });
    expect(second.ok).toBe(false);
    if (second.ok || !("conflict" in second) || !second.conflict) throw new Error("expected a conflict");
    expect(second.conflict.name).toBe("Tab 1");
    expect(second.conflict.revision).toBe(2);
    // Nothing of Tab 2's reached the row.
    expect((await getVersion(ACCOUNT_A, v.id))?.name).toBe("Tab 1");
  });

  it("a save on a deleted version says so", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: blankVersionData() });
    await db.delete(psVersions).where(eq(psVersions.id, v.id));
    const res = await saveVersion({ id: v.id, revision: 1, name: "Main", notes: "", data: v.data });
    expect(res.ok).toBe(false);
    expect(!res.ok && "gone" in res && res.gone).toBe(true);
  });

  it("the query layer returns null on a stale revision without touching the row", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: blankVersionData() });
    expect(await updateVersionIfRevision(ACCOUNT_A, v.id, 7, { name: "x", notes: "", data: v.data }, USER_ID)).toBeNull();
    expect((await getVersion(ACCOUNT_A, v.id))?.name).toBe("Main");
  });

  it("the document is validated on the way in", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: blankVersionData() });
    const res = await saveVersion({ id: v.id, revision: 1, name: "Main", notes: "", data: { ...v.data, plans: [] } });
    expect(res.ok).toBe(false);
  });
});

describe("bootstrap", () => {
  it("creates Blank 'Main' once, and returns the existing version after that", async () => {
    const [first, second] = await Promise.all([bootstrapVersion(), bootstrapVersion()]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.version.id).toBe(second.version.id);
    expect(first.version.name).toBe("Main");
    expect(first.version.data.products).toEqual([]);
    expect(first.version.data.plans).toHaveLength(1);
    expect(await listVersions(ACCOUNT_A)).toHaveLength(1);
    const third = await bootstrapVersion();
    expect(third.ok && !third.created).toBe(true);
  });
});

describe("last opened", () => {
  it("opening stamps opened_at and remembers the version per user per brand", async () => {
    const v1 = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "One", notes: "", data: blankVersionData() });
    const v2 = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Two", notes: "", data: blankVersionData() });
    expect((await openVersion({ id: v1.id })).ok).toBe(true);
    expect(await getLastVersionId(USER_ID, ACCOUNT_A)).toBe(v1.id);
    expect(await getLastVersionId(USER_ID, ACCOUNT_B)).toBeNull();
    await touchVersionOpened(ACCOUNT_A, USER_ID, v2.id);
    expect(await getLastVersionId(USER_ID, ACCOUNT_A)).toBe(v2.id);
    expect(await db.select().from(psUserState)).toHaveLength(1);
    // Most recently opened first.
    expect((await listVersions(ACCOUNT_A)).map((v) => v.name)).toEqual(["Two", "One"]);
    // A foreign id is refused.
    expect((await openVersion({ id: "00000000-0000-0000-0000-00000000dead" })).ok).toBe(false);
  });

  it("deleting the remembered version clears the pointer (SET NULL)", async () => {
    const v = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "One", notes: "", data: blankVersionData() });
    await touchVersionOpened(ACCOUNT_A, USER_ID, v.id);
    expect((await deleteVersion({ id: v.id })).ok).toBe(true);
    expect(await getLastVersionId(USER_ID, ACCOUNT_A)).toBeNull();
    expect(await listVersions(ACCOUNT_A)).toEqual([]);
  });
});

describe("create", () => {
  it("copy, sample, blank and import", async () => {
    const sample = await createVersion({ name: "", notes: "", from: { kind: "sample" } });
    expect(sample.ok && sample.version.name).toBe("Sample data");
    if (!sample.ok) return;
    expect(sample.version.data.products).toHaveLength(5);

    const copy = await createVersion({ name: "", notes: "", from: { kind: "copy", id: sample.version.id } });
    expect(copy.ok && copy.version.name).toBe("Sample data (copy)");
    if (!copy.ok) return;
    expect(copy.version.data).toEqual(sample.version.data);
    expect(copy.version.id).not.toBe(sample.version.id);

    const blank = await createVersion({ name: "Ramadan", notes: "x", from: { kind: "blank" } });
    expect(blank.ok && blank.version.name).toBe("Ramadan");

    const payload = JSON.parse(JSON.stringify(toExport("Exported", sampleVersionData(), new Date())));
    const imported = await createVersion({
      name: "",
      notes: "",
      from: { kind: "import", payload, fileName: "price-structure-main-2026-11-05.json" },
    });
    expect(imported.ok && imported.version.name).toBe("price-structure-main-2026-11-05");
    if (!imported.ok) return;
    expect(imported.version.data.products).toHaveLength(5);

    const bad = await createVersion({ name: "", notes: "", from: { kind: "import", payload: { nope: 1 }, fileName: "x.json" } });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toBe("This file does not look like a Price Structure export.");

    // A copy of another brand's version is refused.
    activeAccount = ACCOUNT_B;
    const stolen = await createVersion({ name: "", notes: "", from: { kind: "copy", id: sample.version.id } });
    expect(stolen.ok).toBe(false);
  });
});

describe("poll", () => {
  it("reports summaries, changed rows and deletions relative to what the client knows", async () => {
    const v1 = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "One", notes: "", data: blankVersionData() });
    const v2 = await insertVersion(db, ACCOUNT_A, USER_ID, { name: "Two", notes: "", data: blankVersionData() });
    await updateVersionIfRevision(ACCOUNT_A, v2.id, 1, { name: "Two!", notes: "", data: v2.data }, USER_ID);
    const out = await pollVersions(ACCOUNT_A, [
      { id: v1.id, revision: 1 },
      { id: v2.id, revision: 1 },
      { id: "00000000-0000-0000-0000-00000000dead", revision: 3 },
    ]);
    expect(out.summaries.map((s) => s.name).sort()).toEqual(["One", "Two!"]);
    expect(out.changed.map((c) => c.id)).toEqual([v2.id]);
    expect(out.deleted).toEqual(["00000000-0000-0000-0000-00000000dead"]);
  });
});

describe("the three grants (2026-11-06)", () => {
  const seed = () => insertVersion(db, ACCOUNT_A, USER_ID, { name: "Main", notes: "", data: sampleVersionData() });

  it("a viewer opens, polls and bootstraps, but saves and creates nothing", async () => {
    grants = new Set(["price_structure.view"]);
    const boot = await bootstrapVersion();
    expect(boot.ok && boot.created).toBe(true);
    if (!boot.ok) return;
    const v = boot.version;
    expect((await openVersion({ id: v.id })).ok).toBe(true);
    const changed = { ...v.data, settings: { ...v.data.settings, deliveryRate: 0.9 } };
    const save = await saveVersion({ id: v.id, revision: v.revision, name: v.name, notes: v.notes, data: changed });
    expect(save.ok).toBe(false);
    expect(!save.ok && save.error).toBe("Missing permission: price_structure.edit");
    const rename = await saveVersion({ id: v.id, revision: v.revision, name: "Renamed", notes: v.notes, data: v.data });
    expect(!rename.ok && rename.error).toBe("Missing permission: price_structure.versions");
    expect((await createVersion({ name: "", notes: "", from: { kind: "blank" } })).ok).toBe(false);
    expect((await deleteVersion({ id: v.id })).ok).toBe(false);
    expect((await getVersion(ACCOUNT_A, v.id))?.revision).toBe(1);
  });

  it("an editor changes the document but not the version's name", async () => {
    grants = new Set(["price_structure.edit"]);
    const v = await seed();
    const changed = { ...v.data, settings: { ...v.data.settings, deliveryRate: 0.9 } };
    const save = await saveVersion({ id: v.id, revision: 1, name: v.name, notes: v.notes, data: changed });
    expect(save.ok).toBe(true);
    const rename = await saveVersion({ id: v.id, revision: 2, name: "Renamed", notes: "", data: changed });
    expect(!rename.ok && rename.error).toBe("Missing permission: price_structure.versions");
    expect((await createVersion({ name: "", notes: "", from: { kind: "copy", id: v.id } })).ok).toBe(false);
  });

  it("a version manager renames, copies and deletes, but leaves the document alone", async () => {
    grants = new Set(["price_structure.versions"]);
    const v = await seed();
    const rename = await saveVersion({ id: v.id, revision: 1, name: "Renamed", notes: "why", data: v.data });
    expect(rename.ok).toBe(true);
    const changed = { ...v.data, settings: { ...v.data.settings, deliveryRate: 0.9 } };
    const edit = await saveVersion({ id: v.id, revision: 2, name: "Renamed", notes: "why", data: changed });
    expect(!edit.ok && edit.error).toBe("Missing permission: price_structure.edit");
    const copy = await createVersion({ name: "", notes: "", from: { kind: "copy", id: v.id } });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect((await deleteVersion({ id: copy.version.id })).ok).toBe(true);
  });

  it("no grant at all is refused everywhere", async () => {
    grants = new Set();
    expect((await bootstrapVersion()).ok).toBe(false);
    expect((await pollVersionsAction({ known: [] })).ok).toBe(false);
  });
});
