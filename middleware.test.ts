import { createHmac } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, middleware } from "./middleware";
import { REQUEST_PATH_HEADER } from "@/lib/signin-redirect";

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

describe("the path is handed to the page, so a layout that refuses can send you back (2026-11-01)", () => {
  // The dashboard layout rejects a cookie the middleware verified (a removed
  // user, revoked sessions) and redirected to a bare /signin — the middleware
  // keeps ?next=, the layout dropped it.
  const SECRET = "test-secret-at-least-16-chars-long";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.AUTH_SECRET = saved;
  });
  const token = () => {
    const payload = `11111111-1111-1111-1111-111111111111.${Date.now()}`;
    return `${payload}.${createHmac("sha256", SECRET).update(payload).digest().toString("base64url")}`;
  };

  it("a verified request carries its path + query to the page — a client's own header is overwritten", async () => {
    const req = new NextRequest("http://localhost/library?tab=products", {
      headers: { cookie: `ccms_session=${token()}`, [REQUEST_PATH_HEADER]: "//evil.example" },
    });
    const res = await middleware(req);
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/library?tab=products");
  });

  it("an unverified one still redirects with ?next=", async () => {
    const res = await middleware(new NextRequest("http://localhost/library?tab=products"));
    expect(res.headers.get("location")).toBe("http://localhost/signin?next=%2Flibrary%3Ftab%3Dproducts");
  });
});
