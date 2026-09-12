import { z } from "zod";
import {
  COMMENT_ANCHOR_TYPES,
  COMMENT_MAX,
  VIEW_QUERY_MAX,
  isCommentableView,
} from "@/lib/comments";
import { MONTH_KEY } from "@/validators/budget";

/**
 * Comment input schemas. Anchors are validated for SHAPE here; whether the
 * anchor actually belongs to the active brand is re-checked in the action
 * (`anchor_id` carries no foreign key — see the schema comment).
 */

export const anchorTypeSchema = z.enum(COMMENT_ANCHOR_TYPES);

export const bodySchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(COMMENT_MAX, `Comments are capped at ${COMMENT_MAX} characters.`);

/**
 * The captured query string — stored verbatim, minus any leading "?". Capped,
 * because it is user-influenced text that ends up in an href.
 */
export const viewQuerySchema = z
  .string()
  .max(VIEW_QUERY_MAX)
  .transform((v) => (v.startsWith("?") ? v.slice(1) : v))
  .nullable()
  .optional();

/** A pathname safe to store and later redirect to, and one we actually offer. */
const viewPathSchema = z
  .string()
  .max(255)
  .refine((v) => v.startsWith("/") && !v.startsWith("//"), "Not an in-app path")
  .refine(isCommentableView, "That page doesn't take comments.");

/**
 * Anchor shape per type: a uuid for entities, `YYYY-MM` for a budget month, an
 * allow-listed pathname for a view.
 */
export const createCommentSchema = z
  .object({
    anchorType: anchorTypeSchema,
    anchorId: z.string().min(1).max(255),
    viewQuery: viewQuerySchema,
    parentId: z.string().uuid().nullable().optional(),
    body: bodySchema,
    /** From the picker only — ids, never names scraped out of the body. */
    mentionUserIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["anchorId"] });
    if (value.anchorType === "creative" || value.anchorType === "campaign") {
      if (!z.string().uuid().safeParse(value.anchorId).success) {
        fail("That anchor isn't valid.");
      }
    } else if (value.anchorType === "budget_month") {
      if (!MONTH_KEY.test(value.anchorId)) fail("That month isn't valid.");
    } else if (!viewPathSchema.safeParse(value.anchorId).success) {
      fail("That page doesn't take comments.");
    }
  });

export const updateCommentSchema = z.object({
  id: z.string().uuid(),
  body: bodySchema,
});

export const deleteCommentSchema = z.object({ id: z.string().uuid() });

/** Reading a thread: the anchor, same shape rules as posting to it. */
export const listCommentsSchema = z
  .object({
    anchorType: anchorTypeSchema,
    anchorId: z.string().min(1).max(255),
  })
  .superRefine((value, ctx) => {
    const ok =
      value.anchorType === "budget_month"
        ? MONTH_KEY.test(value.anchorId)
        : value.anchorType === "view"
          ? viewPathSchema.safeParse(value.anchorId).success
          : z.string().uuid().safeParse(value.anchorId).success;
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That anchor isn't valid.",
        path: ["anchorId"],
      });
    }
  });

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
