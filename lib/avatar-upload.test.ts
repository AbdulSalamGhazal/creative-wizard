import { describe, expect, it } from "vitest";
import { centreSquare } from "@/lib/avatar-upload";

describe("profile photos are cropped to the centre square", () => {
  it("takes the shorter side, centred", () => {
    expect(centreSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(centreSquare(300, 900)).toEqual({ sx: 0, sy: 300, side: 300 });
    expect(centreSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
});
