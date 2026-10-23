import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { FILE_TOO_LARGE_MESSAGE, MAX_FILE_BYTES, MAX_FILE_MB, parseFile } from "@/csv/parse";

/**
 * ONE honest upload limit (D5, 2026-10-23). Every screen promised 10 MB while
 * the server-action surfaces failed past 1 MB (Next's default action body) and
 * the ads route past 4.5 MB (Vercel's function body ceiling). The limit is now
 * 4 MB everywhere, and the action body limit must leave room for it.
 */
const toBytes = (v: string | number | undefined): number => {
  if (typeof v === "number") return v;
  const m = /^(\d+(?:\.\d+)?)\s*(kb|mb)$/i.exec(v ?? "");
  if (!m) return 1024 * 1024; // Next's default: 1 MB
  return Number(m[1]) * (m[2]!.toLowerCase() === "mb" ? 1024 * 1024 : 1024);
};

describe("the upload size limit", () => {
  it("is 4 MB, and says so", () => {
    expect(MAX_FILE_MB).toBe(4);
    expect(MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
    expect(FILE_TOO_LARGE_MESSAGE).toBe("File exceeds the 4 MB upload limit.");
  });

  it("server actions accept a full-size file plus its multipart wrapping, within Vercel's 4.5 MB", () => {
    const limit = toBytes(nextConfig.experimental?.serverActions?.bodySizeLimit);
    expect(limit).toBeGreaterThan(MAX_FILE_BYTES + 64 * 1024);
    expect(limit).toBeLessThanOrEqual(4.5 * 1024 * 1024);
  });

  it("the parser refuses one byte more with E001", () => {
    const res = parseFile({ content: new Uint8Array(1), byteLength: MAX_FILE_BYTES + 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ code: "E001", message: FILE_TOO_LARGE_MESSAGE });
  });
});
