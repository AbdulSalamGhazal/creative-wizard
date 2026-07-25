import { describe, expect, it } from "vitest";
import { getTenantContext, withTenantContext } from "@/lib/tenant-context";

// The AsyncLocalStorage mechanism the MCP override rides on: present INSIDE
// `withTenantContext`, absent outside, and isolated across concurrent runs.

describe("tenant-context (AsyncLocalStorage)", () => {
  it("is undefined outside any context (cookie fallback path)", () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it("exposes the context INSIDE the run, gone after", async () => {
    const inside = await withTenantContext({ accountId: "A", userId: "u1" }, async () => {
      return getTenantContext();
    });
    expect(inside).toEqual({ accountId: "A", userId: "u1" });
    expect(getTenantContext()).toBeUndefined();
  });

  it("survives awaits within the run", async () => {
    const seen = await withTenantContext({ accountId: "A", userId: "u1" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getTenantContext()?.accountId;
    });
    expect(seen).toBe("A");
  });

  it("isolates concurrent runs (no cross-talk)", async () => {
    const [a, b] = await Promise.all([
      withTenantContext({ accountId: "A", userId: "u1" }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getTenantContext()?.accountId;
      }),
      withTenantContext({ accountId: "B", userId: "u2" }, async () => {
        return getTenantContext()?.accountId;
      }),
    ]);
    expect(a).toBe("A");
    expect(b).toBe("B");
  });
});
