import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * A brand's colour + logo (2026-11) through the real actions and the real
 * membership choke point. Only who is signed in, the cookie jar and the image
 * STORE are faked — the store so no test ever writes to a real Blob.
 */
const RESTRICTED = "11111111-1111-1111-1111-1111111111c2";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn() })),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  loadUserById: vi.fn(),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const stored: string[] = [];
const discarded: string[] = [];
vi.mock("@/lib/avatar-storage", async (orig) => {
  const real = await orig<typeof import("@/lib/avatar-storage")>();
  return {
    ...real,
    avatarStore: () => "dev" as const,
    storeImage: vi.fn(async (_f: Blob, _m: string, owner: string, folder: string) => {
      const url = `/dev-uploads/${folder}/${owner}-${stored.length}.webp`;
      stored.push(url);
      return url;
    }),
    discardImage: vi.fn(async (url: string | null) => void (url && discarded.push(url))),
  };
});

import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { auth, requireAuth, requirePermission, type SessionUser } from "@/lib/auth";
import { accounts, auditEvents, userAccounts, users } from "@/db/schema";
import { removeBrandLogo, setBrandColor, uploadBrandLogo } from "@/app/actions/account";
import { listAccounts } from "@/lib/tenant";
import { resetAndSeed } from "./fixtures";

const signIn = (u: SessionUser) => {
  vi.mocked(auth).mockResolvedValue(u);
  vi.mocked(requireAuth).mockResolvedValue(u);
  vi.mocked(requirePermission).mockResolvedValue(u);
};
const me = (): SessionUser => ({
  id: RESTRICTED, email: "r@test.local", name: "R", role: "editor",
  permissions: ["config.brands"], allAccounts: false, avatarUrl: null,
});

/** The 12-byte RIFF…WEBP header is all the sniffer reads. */
const webp = () => new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0])], "l.webp", { type: "image/webp" });
const form = (accountId: string, file: File | null = webp()) => {
  const fd = new FormData();
  fd.append("accountId", accountId);
  if (file) fd.append("file", file);
  return fd;
};
const brand = async (id: string) =>
  (await db.select().from(accounts).where(eq(accounts.id, id)))[0]!;
const styleAudits = (id: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.action, "account.style_update"), eq(auditEvents.entityId, id)));

beforeEach(async () => {
  await resetAndSeed();
  stored.length = 0;
  discarded.length = 0;
  await db.insert(users).values({ id: RESTRICTED, email: "r@test.local", name: "R", role: "editor", allAccounts: false });
  await db.insert(userAccounts).values({ userId: RESTRICTED, accountId: ACCOUNT_A });
  signIn(me());
});

describe("a brand's colour", () => {
  it("saves a swatch, audits it under THAT brand, and lists it", async () => {
    expect(await setBrandColor({ id: ACCOUNT_A, color: "teal" })).toEqual({ ok: true });
    expect((await brand(ACCOUNT_A)).color).toBe("teal");
    expect((await listAccounts())[0]!.color).toBe("teal");
    const [a] = await styleAudits(ACCOUNT_A);
    expect(a!.accountId).toBe(ACCOUNT_A);
    expect(a!.meta).toMatchObject({ fromColor: null, toColor: "teal" });
  });

  it("the same colour again writes nothing", async () => {
    await setBrandColor({ id: ACCOUNT_A, color: "teal" });
    await setBrandColor({ id: ACCOUNT_A, color: "teal" });
    expect(await styleAudits(ACCOUNT_A)).toHaveLength(1);
  });

  it("refuses a colour off the swatch list, and a brand you aren't a member of", async () => {
    expect((await setBrandColor({ id: ACCOUNT_A, color: "#ff0000" })).ok).toBe(false);
    expect(await setBrandColor({ id: ACCOUNT_B, color: "teal" })).toEqual({ ok: false, error: "Unknown brand" });
    expect((await brand(ACCOUNT_B)).color).toBeNull();
  });
});

describe("a brand's logo", () => {
  it("uploads into brand-logos/, replaces (discarding the old), and removes", async () => {
    expect(await uploadBrandLogo(form(ACCOUNT_A))).toEqual({ ok: true });
    const first = (await brand(ACCOUNT_A)).logoUrl!;
    expect(first).toMatch(/^\/dev-uploads\/brand-logos\//);

    expect(await uploadBrandLogo(form(ACCOUNT_A))).toEqual({ ok: true });
    expect((await brand(ACCOUNT_A)).logoUrl).not.toBe(first);
    expect(discarded).toEqual([first]);

    expect(await removeBrandLogo({ id: ACCOUNT_A })).toEqual({ ok: true });
    expect((await brand(ACCOUNT_A)).logoUrl).toBeNull();
    expect((await styleAudits(ACCOUNT_A)).map((r) => (r.meta as { logo?: string }).logo).sort())
      .toEqual(["added", "added", "removed"]);
  });

  it("checks membership and content BEFORE a byte is stored", async () => {
    expect(await uploadBrandLogo(form(ACCOUNT_B))).toEqual({ ok: false, error: "Unknown brand" });
    const gif = new File([new TextEncoder().encode("GIF89a.........")], "x.webp", { type: "image/webp" });
    expect((await uploadBrandLogo(form(ACCOUNT_A, gif))).ok).toBe(false);
    expect((await uploadBrandLogo(form(ACCOUNT_A, null))).ok).toBe(false);
    expect(stored).toEqual([]);
    expect((await brand(ACCOUNT_B)).logoUrl).toBeNull();
  });
});
