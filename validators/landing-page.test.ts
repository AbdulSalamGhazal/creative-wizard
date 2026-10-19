import { describe, expect, it } from "vitest";
import { landingPageInputSchema } from "@/validators/landing-page";

const valid = { name: " Ramadan offer ", code: "ramadan", url: "https://urjwan.com/ramadan" };

describe("landingPageInputSchema", () => {
  it("trims, and stores a blank description as null", () => {
    const res = landingPageInputSchema.safeParse({ ...valid, description: "   " });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.name).toBe("Ramadan offer");
      expect(res.data.description).toBeNull();
    }
  });

  it("forgives a pasted leading @ on the code", () => {
    const res = landingPageInputSchema.safeParse({ ...valid, code: " @ramadan " });
    expect(res.success && res.data.code).toBe("ramadan");
  });

  it.each(["", "ram adan", "ram.adan", "@", "a@b"])("refuses the code %j", (code) => {
    const res = landingPageInputSchema.safeParse({ ...valid, code });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["code"]);
  });

  it.each(["", "urjwan.com/ramadan", "ftp://urjwan.com", "javascript:alert(1)"])(
    "refuses the link %j",
    (url) => {
      const res = landingPageInputSchema.safeParse({ ...valid, url });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues[0]?.path).toEqual(["url"]);
    },
  );

  it("caps the description at 200 characters", () => {
    expect(landingPageInputSchema.safeParse({ ...valid, description: "x".repeat(200) }).success).toBe(true);
    expect(landingPageInputSchema.safeParse({ ...valid, description: "x".repeat(201) }).success).toBe(false);
  });
});
