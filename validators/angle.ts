import { z } from "zod";

/**
 * Angle names (`app/actions/angle.ts`) mirror the creative_angles column:
 * 1–64 chars, trimmed. Moved here verbatim 2026-11-19.
 */
export const angleNameSchema = z.string().trim().min(1, "Name is required").max(64);
