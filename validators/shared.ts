import { z } from "zod";

/** Sort directions, for every table that carries one in its URL. */
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/**
 * The comma-separated URL params every filter page reads (`platforms=a,b`).
 *
 * ONE helper for every page (W3-1, 2026-10). There were five copies and they
 * disagreed: four reset the WHOLE array on one bad token
 * (`.pipe(z.array(z.enum)).catch([])`), so a stale `platforms=meta,instagram`
 * link kept Instagram on the Library but emptied Ads, and a saved Ads view
 * naming one retired column re-opened every hidden column. The decided
 * behaviour is the Library's: drop ONLY the invalid tokens and keep their
 * valid siblings — a retired value, a hand-edited link or a remembered value
 * shared from another page never disables a filter nobody asked to clear.
 * Parts are trimmed and empty parts dropped; an absent param is `[]`, which
 * every query reads as "no filter".
 */
export function parseCsvEnum<T extends string>(
  s: string | null | undefined,
  allowed: readonly T[],
): T[] {
  if (!s) return [];
  const set = new Set<string>(allowed);
  return s
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is T => v !== "" && set.has(v));
}

/** `parseCsvEnum` as a Zod field (the validators' form). Never throws. */
export function csvEnum<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .optional()
    .catch(undefined)
    .transform((s) => parseCsvEnum(s, allowed));
}

/**
 * A comma-separated list with no vocabulary (ids, names): split, empty parts
 * dropped, never throws. The query layer re-validates ids (an `allow` list).
 */
export function csvList() {
  return z
    .string()
    .optional()
    .catch(undefined)
    .transform((s) => (s ? s.split(",").filter(Boolean) : []));
}
