import { describe, it, expect } from "vitest";
import { campaignPlatformCollisions } from "@/csv/cross-platform";

describe("campaignPlatformCollisions (E060)", () => {
  it("returns no errors when nothing exists on other platforms", () => {
    expect(campaignPlatformCollisions("snapchat", ["Camp A"], [])).toEqual([]);
  });

  it("flags a file campaign that already exists on another platform", () => {
    const errors = campaignPlatformCollisions(
      "snapchat",
      ["Camp A", "Camp B"],
      [{ campaignName: "Camp A", platform: "instagram" }],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("E060");
    expect(errors[0]!.severity).toBe("ERROR");
    expect(errors[0]!.value).toBe("Camp A");
    expect(errors[0]!.message).toContain("Camp A");
  });

  it("does NOT flag a name that exists only on the SAME platform (re-upload/upsert)", () => {
    const errors = campaignPlatformCollisions(
      "snapchat",
      ["Camp A"],
      [{ campaignName: "Camp A", platform: "snapchat" }],
    );
    expect(errors).toEqual([]);
  });

  it("ignores existing campaigns that are not in the file", () => {
    const errors = campaignPlatformCollisions(
      "snapchat",
      ["Camp A"],
      [{ campaignName: "Camp Z", platform: "instagram" }],
    );
    expect(errors).toEqual([]);
  });

  it("lists every other platform a name lives on, in one error", () => {
    const errors = campaignPlatformCollisions(
      "snapchat",
      ["Camp A"],
      [
        { campaignName: "Camp A", platform: "instagram" },
        { campaignName: "Camp A", platform: "facebook" },
      ],
    );
    expect(errors).toHaveLength(1);
    // both other platforms named in the single message
    expect(errors[0]!.message.toLowerCase()).toContain("instagram");
    expect(errors[0]!.message.toLowerCase()).toContain("facebook");
  });

  it("returns one sorted error per colliding name", () => {
    const errors = campaignPlatformCollisions(
      "snapchat",
      ["Beta", "Alpha"],
      [
        { campaignName: "Beta", platform: "instagram" },
        { campaignName: "Alpha", platform: "instagram" },
      ],
    );
    expect(errors.map((e) => e.value)).toEqual(["Alpha", "Beta"]);
  });
});
