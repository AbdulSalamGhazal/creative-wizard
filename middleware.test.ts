import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "./middleware";

/**
 * The auth gate's matcher, read as the regex Next compiles it to. A path the
 * matcher MATCHES goes through the cookie check; one it doesn't is public.
 *
 * Why this exists (audit C-04, 2026-10-23): the matcher still exempted
 * `icon.svg` long after the tab icon became `app/icon.png`, and never knew
 * `public/logo.png` — so the sign-in page's own logo and the tab icon
 * redirected a signed-out visitor to /signin. Every root static asset is now
 * checked from the filesystem, so the next renamed asset fails here.
 */
const gate = new RegExp(`^${config.matcher[0]}$`);
const isGated = (p: string) => gate.test(p);

const ROOT = path.resolve(__dirname);

describe("middleware matcher", () => {
  it("exempts every root-level file in public/", () => {
    const files = readdirSync(path.join(ROOT, "public")).filter((f) =>
      statSync(path.join(ROOT, "public", f)).isFile(),
    );
    expect(files).toContain("logo.png");
    for (const f of files) expect(isGated(`/${f}`), f).toBe(false);
  });

  it("exempts the app icon (the file convention serves it at the root)", () => {
    const icons = readdirSync(path.join(ROOT, "app")).filter((f) => /^icon\./.test(f));
    expect(icons.length).toBeGreaterThan(0);
    for (const f of icons) expect(isGated(`/${f}`), f).toBe(false);
    expect(isGated("/favicon.ico")).toBe(false);
  });

  it("still gates pages, nested asset-looking paths and the API", () => {
    for (const p of [
      "/",
      "/admin/users",
      "/library/some-creative",
      "/admin/export.svg",
      "/dev-uploads/avatars/someone.png",
      "/api/uploads/commit",
      "/oauth/consent",
    ]) {
      expect(isGated(p), p).toBe(true);
    }
  });

  it("leaves the public endpoints public", () => {
    for (const p of ["/signin", "/api/health", "/api/mcp/mcp", "/api/oauth/token", "/.well-known/oauth-authorization-server"]) {
      expect(isGated(p), p).toBe(false);
    }
  });
});
