import { z } from "zod";
import { platformEnum } from "@/lib/enums";

/**
 * Ads upload routes (`app/api/uploads/validate` and `/commit`). Moved here
 * verbatim 2026-11-19 so every input schema lives in `validators/`.
 */

/** The platform a file is validated against — derived, never re-listed. */
export const uploadPlatformSchema = z.enum(platformEnum);

/** Commit a validated upload by its session token. */
export const uploadCommitSchema = z.object({
  token: z.string().uuid(),
});
