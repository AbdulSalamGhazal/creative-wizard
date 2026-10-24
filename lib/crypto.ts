import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality of two hex strings. Different lengths → false without
 * leaking via early return. Used on a stored-vs-computed hash as defense in
 * depth on top of the indexed hash lookup (API tokens and OAuth secrets —
 * W3-7: each module carried its own copy).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
