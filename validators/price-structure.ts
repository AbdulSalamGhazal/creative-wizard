import { z } from "zod";
import { versionDataSchema } from "@/price-structure/schema";

/**
 * Inputs of the Price Structure server actions. The document itself is
 * validated by `price-structure/schema.ts` — the one gate shared with the
 * jsonb read-back and the JSON import — so a save, an import and a stored
 * row can never disagree about what a version looks like.
 */
export const VERSION_NAME_MAX = 120;
export const VERSION_NOTES_MAX = 2000;

const versionName = z.string().trim().min(1, "Give the version a name.").max(VERSION_NAME_MAX);
const versionNotes = z.string().max(VERSION_NOTES_MAX).default("");

export const saveVersionSchema = z.object({
  id: z.string().uuid(),
  /** The revision the client's copy was based on. */
  revision: z.number().int().min(1),
  name: versionName,
  notes: versionNotes,
  data: versionDataSchema,
});

export const createVersionSchema = z.object({
  /** Empty → the server names it after the source ("{current} (copy)", "Sample data", "Blank", the file). */
  name: z.string().trim().max(VERSION_NAME_MAX).default(""),
  notes: versionNotes,
  from: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("blank") }),
    z.object({ kind: z.literal("sample") }),
    z.object({ kind: z.literal("copy"), id: z.string().uuid() }),
    z.object({
      kind: z.literal("import"),
      /** The parsed JSON document, as uploaded. */
      payload: z.unknown(),
      fileName: z.string().max(255).default(""),
    }),
  ]),
});

export const versionIdSchema = z.object({ id: z.string().uuid() });

export const pollVersionsSchema = z.object({
  known: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().min(0) })).max(500),
});

export type SaveVersionInput = z.infer<typeof saveVersionSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

// ── Pricing · Actual (2026-11-27) ───────────────────────────────────────────

/** The Actual page's URL: a range like every range page; a bad value falls back. */
export const actualParamsSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
});

/** A Pricing document id (product or offer) — the version schema's own bound. */
const psId = z.string().min(1).max(200);
/** The Store's line key: a SKU, or a name when Salla sent none. */
const productKey = z.string().trim().min(1).max(500);

/** One mapping change; `null` clears it. */
export const mappingChangeSchema = z.discriminatedUnion("what", [
  z.object({ what: z.literal("sku"), productKey, psProductId: psId.nullable() }),
  z.object({
    what: z.literal("offer"),
    productKey,
    quantity: z.number().int().min(1).max(1000),
    psOfferId: psId.nullable(),
  }),
  z.object({ what: z.literal("ads"), productId: z.string().uuid(), psProductId: psId.nullable() }),
]);

export type MappingChange = z.infer<typeof mappingChangeSchema>;
