/**
 * A starter password the Team page can hand to a new member (2026-11-06).
 * The app has no mailer, so the inviter shares the credential over a trusted
 * channel — typing one by hand produced "Welcome123" every time. Generated
 * here: 14 characters from an alphabet with no look-alikes (no 0/O, 1/l/I),
 * so it survives being read aloud or retyped from a chat message, drawn from
 * `crypto.getRandomValues` with rejection sampling (no modulo bias).
 *
 * Pure and dependency-free so both the browser (the dialog's Generate button)
 * and a unit test can run it.
 */
export const STARTER_PASSWORD_LENGTH = 14;

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateStarterPassword(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
  length = STARTER_PASSWORD_LENGTH,
): string {
  // Rejection sampling: 256 is not a multiple of the alphabet size, so values
  // at or past the largest multiple are redrawn rather than wrapped.
  const limit = 256 - (256 % ALPHABET.length);
  const out: string[] = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    random(buf);
    for (const byte of buf) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** Every character a generated password may contain (for the test). */
export const STARTER_PASSWORD_ALPHABET = ALPHABET;
