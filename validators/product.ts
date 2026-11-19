import { z } from "zod";

/**
 * Product names (`app/actions/product.ts`). Trimmed BEFORE the length check —
 * trimming after let "   " pass min(1) and insert a product with an empty
 * name (2026-10-31). Moved here verbatim 2026-11-19.
 */
export const productNameSchema = z.string().trim().min(1).max(255);
