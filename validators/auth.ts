import { z } from "zod";

/**
 * A network address read from a request header (F1, 2026-10-24) — the key
 * the sign-in throttle counts by. Bounded and shaped like an IP, or it is not
 * an address at all: a header carrying anything else reads as "no address",
 * never as a fresh throttle key. Lower-cased so one IPv6 address is one key.
 */
export const clientIpSchema = z
  .string()
  .trim()
  .max(64)
  .ip()
  .transform((s) => s.toLowerCase());
