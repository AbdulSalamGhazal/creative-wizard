import { z } from "zod";

/**
 * Whose profile photo an ADMIN is changing (Team page). The self-service path
 * takes no id at all — the session user is the subject — so a hand-made
 * request can't aim it at someone else.
 */
export const avatarTargetSchema = z.object({ userId: z.string().uuid() });

/** The upload's optional `userId` form field: absent = yourself. */
export const avatarUploadTargetSchema = z.string().uuid().nullable();
