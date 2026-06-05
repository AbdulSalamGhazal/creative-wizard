"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { ACCOUNT_COOKIE, listAccounts } from "@/lib/tenant";
import {
  createAccountSchema,
  renameAccountSchema,
  setActiveAccountSchema,
  setStatusWindowSchema,
} from "@/validators/account";

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base || "brand";
}

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
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Create a new brand (admin). Starts empty — no creatives/products/etc. */
export async function createAccount(input: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = createAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }

    // Ensure a unique slug.
    const existing = new Set(
      (await db.select({ slug: accounts.slug }).from(accounts)).map((r) => r.slug),
    );
    const base = slugify(parsed.data.name);
    let slug = base;
    let n = 2;
    while (existing.has(slug)) slug = `${base}-${n++}`;

    const [row] = await db
      .insert(accounts)
      .values({ name: parsed.data.name, slug })
      .returning({ id: accounts.id });

    revalidatePath("/", "layout");
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Set a brand's "Active" status window, in hours (admin). */
export async function setStatusWindow(input: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = setStatusWindowSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid window" };
    }
    await db
      .update(accounts)
      .set({ statusWindowHours: parsed.data.hours })
      .where(eq(accounts.id, parsed.data.id));

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Rename a brand (admin). Slug is left unchanged (it's just an internal key). */
export async function renameAccount(input: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = renameAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    await db
      .update(accounts)
      .set({ name: parsed.data.name })
      .where(eq(accounts.id, parsed.data.id));

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
