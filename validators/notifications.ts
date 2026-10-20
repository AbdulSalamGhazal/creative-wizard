import { z } from "zod";
import {
  BELL_UNREAD_CAP,
  EVENT_TYPE_KEYS,
  NOTIFICATION_CATEGORIES,
} from "@/lib/notifications";

/**
 * Notification input schemas. Event types and categories derive from the
 * catalog in `lib/notifications.ts` — neither is re-listed here.
 */

export const eventTypeSchema = z.enum(
  EVENT_TYPE_KEYS as unknown as [string, ...string[]],
);

export const categorySchema = z.enum(
  NOTIFICATION_CATEGORIES as unknown as [string, ...string[]],
);

/** One notification of the caller's own. */
export const notificationIdSchema = z.object({ id: z.string().uuid() });

/**
 * The ids the bell LISTED when it was opened — bounded by what the bell can
 * show, so the action can never be a bulk sweep (2026-10-20).
 */
export const notificationIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(BELL_UNREAD_CAP),
});

/** One event's recipient set — a full replace, so an empty list is valid. */
export const saveRoutesSchema = z.object({
  eventType: eventTypeSchema,
  userIds: z.array(z.string().uuid()).max(200),
});
