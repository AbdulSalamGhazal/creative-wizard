import { clientIpSchema } from "@/validators/auth";

/** The two request headers the host reports the visitor's address in. */
interface HeaderSource {
  get(name: string): string | null;
}

/**
 * The visitor's network address as the host reports it (F1, 2026-10-24): the
 * FIRST hop of `x-forwarded-for` (the client — later hops are proxies), else
 * `x-real-ip`. Vercel sets both and overwrites any value the client sent, so
 * there neither can be spoofed; behind another proxy they are only as
 * trustworthy as that proxy. A value that isn't an IP address is skipped, and
 * null means "no address" — the sign-in throttle then falls back to counting
 * by email alone, the strictest key, so a stripped or garbled header can never
 * buy a fresh count.
 */
export function clientIp(headers: HeaderSource): string | null {
  const candidates = [headers.get("x-forwarded-for")?.split(",")[0], headers.get("x-real-ip")];
  for (const raw of candidates) {
    if (raw == null) continue;
    const parsed = clientIpSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  return null;
}
