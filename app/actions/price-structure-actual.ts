"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { EDIT_REFUSED, requirePriceStructureAccess } from "@/lib/price-structure-access";
import { listVersions } from "@/db/queries/price-structure";
import {
  libraryProductInAccount,
  setAdProduct,
  setSkuOffer,
  setSkuProduct,
} from "@/db/queries/price-structure-actual";
import { psSkuMappings } from "@/db/schema";
import { mappingChangeSchema } from "@/validators/price-structure";
import type { Product } from "@/price-structure/engine/types";

/**
 * Pricing · Actual — the mapping writes (2026-11-27). Per BRAND: a SKU → a
 * Pricing product, a SKU at a quantity → an offer, a Library product's ad
 * spend → a Pricing product. Needs `price_structure.edit` (viewers see the
 * mapping read-only). A product or offer id must exist in one of the brand's
 * versions — a caller-supplied id is re-validated against the active brand
 * before it is written (tenancy rule 4). Audited one row per change.
 */
export interface MappingResult {
  ok: boolean;
  error?: string;
}

const STALE = "That product or offer no longer exists in any version. Reload to see the latest.";

function revalidateSafe() {
  try {
    revalidatePath("/price-structure/actual");
    revalidatePath("/price-structure/actual/mapping");
  } catch (err) {
    console.warn("revalidatePath after a Pricing mapping change failed:", err);
  }
}

export async function saveMapping(input: unknown): Promise<MappingResult> {
  try {
    const { user, access } = await requirePriceStructureAccess();
    if (!access.edit) return { ok: false, error: EDIT_REFUSED };
    const parsed = mappingChangeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const change = parsed.data;
    const acct = await getActiveAccountId();

    // Every product the brand's versions know, by id (a copy keeps its ids,
    // so one id usually names the same product in several versions).
    const known = new Map<string, Product>();
    for (const v of await listVersions(acct)) for (const p of v.data.products) if (!known.has(p.id)) known.set(p.id, p);

    let to: string | null = null;
    let libraryName: string | null = null;
    if (change.what === "sku") {
      if (change.psProductId !== null) {
        const p = known.get(change.psProductId);
        if (!p) return { ok: false, error: STALE };
        to = p.name;
      }
      await db.transaction((tx) => setSkuProduct(tx, acct, user.id, change.productKey, change.psProductId));
    } else if (change.what === "offer") {
      if (change.psOfferId !== null) {
        const [row] = await db
          .select({ p: psSkuMappings.psProductId })
          .from(psSkuMappings)
          .where(and(eq(psSkuMappings.accountId, acct), eq(psSkuMappings.productKey, change.productKey)));
        if (!row) return { ok: false, error: "Choose the SKU's product first." };
        const offer = known.get(row.p)?.offers.find((o) => o.id === change.psOfferId);
        if (!offer) return { ok: false, error: STALE };
        to = offer.name;
      }
      await setSkuOffer(db, acct, user.id, change.productKey, change.quantity, change.psOfferId);
    } else {
      libraryName = await libraryProductInAccount(db, acct, change.productId);
      if (libraryName === null) {
        return { ok: false, error: "That Library product isn't in this brand. Reload to see the latest." };
      }
      if (change.psProductId !== null) {
        const p = known.get(change.psProductId);
        if (!p) return { ok: false, error: STALE };
        to = p.name;
      }
      await setAdProduct(db, acct, user.id, change.productId, change.psProductId);
    }

    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.PS_MAPPING_UPDATE,
      entityType: "price_structure",
      actorUserId: user.id,
      accountId: acct,
      meta:
        change.what === "ads"
          ? { what: "ads", key: libraryName, productId: change.productId, to }
          : change.what === "offer"
            ? { what: "offer", key: change.productKey, quantity: change.quantity, to }
            : { what: "sku", key: change.productKey, to },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps_mapping") };
  }
}
