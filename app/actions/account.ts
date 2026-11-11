"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "@/lib/auth";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { accounts, userAccounts, storeOrderFields } from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows } from "@/store/fields";
import { ACCOUNT_COOKIE, listAccounts } from "@/lib/tenant";
import {
  createAccountSchema,
  renameAccountSchema,
  setActiveAccountSchema,
  setStatusWindowSchema,
  setBrandColorSchema,
  brandTargetSchema,
} from "@/validators/account";
import { writeBrandLogo } from "@/lib/brand-logo-write";
import { sniffImageType } from "@/lib/image-sniff";
import { avatarStore, discardImage, storeImage } from "@/lib/avatar-storage";
import { actionError } from "@/lib/action-error";
import { slugify } from "@/lib/url";

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const brandSlug = (name: string): string => slugify(name, "brand", 100);

/**
 * Set the active brand for this user (writes the `ccms_account` cookie). Any
 * signed-in user may switch to any brand. Revalidates everything so all data
 * re-reads under the new account.
 */
export async function setActiveAccount(input: unknown): Promise<ActionResult> {
  try {
    await requireAuth();
    const parsed = setActiveAccountSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid account" };

    const all = await listAccounts();
    if (!all.some((a) => a.id === parsed.data.accountId)) {
      return { ok: false, error: "Unknown brand" };
    }

    const jar = await cookies();
    jar.set({
      name: ACCOUNT_COOKIE,
      value: parsed.data.accountId,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/** Create a new brand (admin). Starts empty — no creatives/products/etc. */
export async function createAccount(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const parsed = createAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }

    // Ensure a unique slug.
    const existing = new Set(
      (await db.select({ slug: accounts.slug }).from(accounts)).map((r) => r.slug),
    );
    const base = brandSlug(parsed.data.name);
    let slug = base;
    let n = 2;
    while (existing.has(slug)) slug = `${base}-${n++}`;

    // A restricted (non-all_accounts) creator would otherwise create a brand
    // they immediately can't see. Grant themselves membership in the same
    // transaction. Admins / all-accounts users already see every brand.
    const restricted = user.role !== "admin" && !user.allAccounts;
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({ name: parsed.data.name, slug })
        .returning({ id: accounts.id });
      if (restricted && created) {
        await tx
          .insert(userAccounts)
          .values({ userId: user.id, accountId: created.id });
      }
      // Seed the three locked Store core fields for the new brand (existing
      // brands got them in migration 0030). See store/fields.ts.
      if (created) {
        // Five rows: the 3 core identity fields + the 2 system-required
        // attribute fields (utm_source, channel) every account must carry.
        await tx
          .insert(storeOrderFields)
          .values([
            ...coreFieldRows(created.id),
            ...systemRequiredFieldRows(created.id),
          ]);
      }
      return created;
    });

    // Logged under the admin's CURRENT brand (where they took the action), so
    // it surfaces in the feed they're looking at. The new brand starts empty.
    await logAudit({
      action: AUDIT_ACTIONS.ACCOUNT_CREATE,
      entityType: "account",
      entityId: row?.id ?? null,
      entityLabel: parsed.data.name,
      actorUserId: user.id,
      meta: { slug },
    });

    revalidatePath("/", "layout");
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/** Set a brand's "Active" status window, in hours (admin). */
export async function setStatusWindow(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const parsed = setStatusWindowSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid window" };
    }
    // Membership: can only touch a brand you're allowed to see.
    const allowed = await listAccounts();
    if (!allowed.some((a) => a.id === parsed.data.id)) {
      return { ok: false, error: "Unknown brand" };
    }
    // Capture the old window + brand name first — this config silently changes
    // how every creative's status is derived for the brand, so the before→after
    // belongs in that brand's audit history.
    const [before] = await db
      .select({ name: accounts.name, hours: accounts.statusWindowHours })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.id))
      .limit(1);

    await db
      .update(accounts)
      .set({ statusWindowHours: parsed.data.hours })
      .where(eq(accounts.id, parsed.data.id));

    await logAudit({
      action: AUDIT_ACTIONS.ACCOUNT_WINDOW_UPDATE,
      entityType: "account",
      entityId: parsed.data.id,
      entityLabel: before?.name ?? null,
      actorUserId: user.id,
      accountId: parsed.data.id,
      meta: { fromHours: before?.hours ?? null, toHours: parsed.data.hours },
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/** Rename a brand (admin). Slug is left unchanged (it's just an internal key). */
export async function renameAccount(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const parsed = renameAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    // Membership: can only rename a brand you're allowed to see.
    const allowed = await listAccounts();
    if (!allowed.some((a) => a.id === parsed.data.id)) {
      return { ok: false, error: "Unknown brand" };
    }
    const [before] = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.id))
      .limit(1);

    await db
      .update(accounts)
      .set({ name: parsed.data.name })
      .where(eq(accounts.id, parsed.data.id));

    await logAudit({
      action: AUDIT_ACTIONS.ACCOUNT_RENAME,
      entityType: "account",
      entityId: parsed.data.id,
      entityLabel: parsed.data.name,
      actorUserId: user.id,
      accountId: parsed.data.id,
      meta: { from: before?.name ?? null, to: parsed.data.name },
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/**
 * Set a brand's colour swatch (config.brands, 2026-11). Audited under THAT
 * brand, like a rename — the colour is how people tell brands apart.
 */
export async function setBrandColor(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const parsed = setBrandColorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Pick one of the colours" };
    const allowed = await listAccounts();
    if (!allowed.some((a) => a.id === parsed.data.id)) {
      return { ok: false, error: "Unknown brand" };
    }
    const [before] = await db
      .select({ name: accounts.name, color: accounts.color })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.id))
      .limit(1);
    if (before?.color === parsed.data.color) return { ok: true };

    await db
      .update(accounts)
      .set({ color: parsed.data.color })
      .where(eq(accounts.id, parsed.data.id));

    await logAudit({
      action: AUDIT_ACTIONS.ACCOUNT_STYLE_UPDATE,
      entityType: "account",
      entityId: parsed.data.id,
      entityLabel: before?.name ?? null,
      actorUserId: user.id,
      accountId: parsed.data.id,
      meta: { fromColor: before?.color ?? null, toColor: parsed.data.color },
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/** Remove a brand's logo (config.brands) — it falls back to its initial. */
export async function removeBrandLogo(input: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const parsed = brandTargetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid brand" };
    const allowed = await listAccounts();
    if (!allowed.some((a) => a.id === parsed.data.id)) {
      return { ok: false, error: "Unknown brand" };
    }
    const res = await writeBrandLogo({ accountId: parsed.data.id, url: null, actorUserId: user.id });
    if (!res.ok) return res;
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}

/** A backstop: the browser sends a 128 px WebP of a few KB. */
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

/**
 * Upload a brand's logo (config.brands + membership, both checked BEFORE a
 * byte is stored). FormData: `accountId` and `file` — the browser already
 * fitted it into a transparent 128 px WebP (`fitBrandLogo`). The bytes are
 * verified by content, never by the declared type, because the file is
 * served from a public host. A server action rather than a route (unlike
 * avatars) so it revalidates like every other brand edit: one render, no
 * refresh.
 */
export async function uploadBrandLogo(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission("config.brands");
    const target = brandTargetSchema.safeParse({ id: formData.get("accountId") });
    if (!target.success) return { ok: false, error: "Invalid brand" };
    const allowed = await listAccounts();
    if (!allowed.some((a) => a.id === target.data.id)) {
      return { ok: false, error: "Unknown brand" };
    }
    if (avatarStore() === null) {
      return { ok: false, error: "Image storage isn't configured (BLOB_READ_WRITE_TOKEN)." };
    }
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No image provided." };
    if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "Image too large." };
    const sniffed = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!sniffed || !LOGO_TYPES.has(sniffed)) {
      return { ok: false, error: "Use a JPG, PNG or WebP image." };
    }

    const url = await storeImage(file, sniffed, target.data.id, "brand-logos");
    const written = await writeBrandLogo({ accountId: target.data.id, url, actorUserId: user.id });
    if (!written.ok) {
      await discardImage(url, "brand-logos");
      return written;
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "account") };
  }
}
