import { describe, expect, it } from "vitest";
import {
  STARTER_PASSWORD_ALPHABET,
  STARTER_PASSWORD_LENGTH,
  generateStarterPassword,
} from "@/lib/starter-password";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

describe("generateStarterPassword", () => {
  it("is long enough for the policy and drawn only from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateStarterPassword();
      expect(pw).toHaveLength(STARTER_PASSWORD_LENGTH);
      expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      for (const ch of pw) expect(STARTER_PASSWORD_ALPHABET).toContain(ch);
    }
    expect(STARTER_PASSWORD_ALPHABET).not.toMatch(/[0OIl1]/);
  });
  it("rejects bytes past the alphabet's largest multiple instead of wrapping them", () => {
    // 255 would wrap to a low index under modulo; it must be redrawn.
    const fed = [255, 255, 0, 1, 2];
    let i = 0;
    const random = (b: Uint8Array) => {
      for (let k = 0; k < b.length; k++) b[k] = fed[i++ % fed.length]!;
      return b;
    };
    const pw = generateStarterPassword(random, 3);
    expect(pw).toBe(STARTER_PASSWORD_ALPHABET.slice(0, 3));
  });
  it("two draws differ", () => {
    expect(generateStarterPassword()).not.toBe(generateStarterPassword());
  });
});
