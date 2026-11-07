import { describe, expect, it } from "vitest";
import { isRedactedServerError, looksLikeDbError } from "@/lib/error-copy";

describe("error copy (R-039)", () => {
  it("reads a connection failure as a data blip", () => {
    expect(looksLikeDbError("write CONNECT_TIMEOUT db.neon.tech:5432")).toBe(true);
    expect(looksLikeDbError("Cannot read properties of undefined")).toBe(false);
    expect(looksLikeDbError(undefined)).toBe(false);
  });
  it("treats a redacted production server error as a data blip only with a digest", () => {
    const msg =
      "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.";
    expect(isRedactedServerError({ message: msg, digest: "123" })).toBe(true);
    expect(isRedactedServerError({ message: msg })).toBe(false);
    expect(isRedactedServerError({ message: "boom", digest: "123" })).toBe(false);
  });
});
