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
