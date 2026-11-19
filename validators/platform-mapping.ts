import { z } from "zod";
import { platformEnum } from "@/lib/enums";
import { INTERNAL_FIELDS } from "@/csv/platforms/types";

/**
 * One CSV header mapping (`app/actions/platform-mapping.ts`). Moved here
 * verbatim 2026-11-19. Both vocabularies are DERIVED, never re-listed (the
 * enum-drift trap in CLAUDE.md); `platformEnum` comes from `lib/enums`, not
 * the schema, so this file is safe for a client to import.
 */
export const platformMappingSchema = z.object({
  platform: z.enum(platformEnum),
  internalField: z.enum(INTERNAL_FIELDS),
  headerName: z.string().min(1).max(255),
});
