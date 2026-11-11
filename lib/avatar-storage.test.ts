import { describe, expect, it } from "vitest";
import { avatarStore, isOwnAvatarUrl, isOwnImageUrl } from "@/lib/avatar-storage";

describe("where profile photos may live", () => {
  it("only our own stores' URLs are ever written or deleted", () => {
    expect(isOwnAvatarUrl("https://abc123.public.blob.vercel-storage.com/avatars/u-1.webp")).toBe(true);
    expect(isOwnAvatarUrl("/dev-uploads/avatars/u-1.webp")).toBe(true);
    // Another folder on the same host (creative thumbnails), another host, a trick.
    expect(isOwnAvatarUrl("https://abc123.public.blob.vercel-storage.com/creatives/thumbnails/x.webp")).toBe(false);
    expect(isOwnAvatarUrl("https://evil.example/avatars/x.webp")).toBe(false);
    expect(isOwnAvatarUrl("http://abc123.public.blob.vercel-storage.com/avatars/x.webp")).toBe(false);
    expect(isOwnAvatarUrl("/dev-uploads/avatars/../../.env.local")).toBe(false);
    expect(isOwnAvatarUrl("javascript:alert(1)")).toBe(false);
  });

  it("the local file fallback can never run in production", () => {
    expect(avatarStore({ BLOB_READ_WRITE_TOKEN: "t", NODE_ENV: "production" })).toBe("blob");
    expect(avatarStore({ BLOB_READ_WRITE_TOKEN: "t", NODE_ENV: "development" })).toBe("blob");
    expect(avatarStore({ NODE_ENV: "development" })).toBe("dev");
    expect(avatarStore({ NODE_ENV: "production" })).toBeNull();
  });
});

describe("brand logos have their own folder", () => {
  it("a logo URL is not an avatar URL, and the other way round", () => {
    const logo = "https://abc123.public.blob.vercel-storage.com/brand-logos/b-1.webp";
    const avatar = "https://abc123.public.blob.vercel-storage.com/avatars/u-1.webp";
    expect(isOwnImageUrl(logo, "brand-logos")).toBe(true);
    expect(isOwnImageUrl(avatar, "brand-logos")).toBe(false);
    expect(isOwnAvatarUrl(logo)).toBe(false);
    expect(isOwnImageUrl("/dev-uploads/brand-logos/b-1.webp", "brand-logos")).toBe(true);
    expect(isOwnImageUrl("/dev-uploads/brand-logos/../avatars/x.webp", "brand-logos")).toBe(false);
  });
});
