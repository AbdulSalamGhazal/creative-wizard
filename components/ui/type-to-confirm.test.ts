import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { confirmMatches } from "@/components/ui/type-to-confirm";

describe("type-to-confirm (D23)", () => {
  it("an entity's name must be typed exactly (trimmed, case-sensitive)", () => {
    expect(confirmMatches("UGC Hook 01", "UGC Hook 01")).toBe(true);
    expect(confirmMatches("  UGC Hook 01 ", "UGC Hook 01")).toBe(true);
    expect(confirmMatches("ugc hook 01", "UGC Hook 01")).toBe(false);
    expect(confirmMatches("UGC Hook", "UGC Hook 01")).toBe(false);
    expect(confirmMatches("", "UGC Hook 01")).toBe(false);
  });
  it("DELETE may be typed in any case, as the cleanup tools always allowed", () => {
    expect(confirmMatches("delete", "DELETE", true)).toBe(true);
  });
  it("both unrecoverable entity deletes require it", () => {
    for (const f of [
      "components/creative/delete-creative-dialog.tsx",
      "components/campaign/delete-campaign-dialog.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<TypeToConfirm");
      expect(src, f).toContain("disabled={!confirmed || isPending}");
    }
  });
});
