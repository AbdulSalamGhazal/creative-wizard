import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({
  allowedAccountsForUser: vi.fn(async () => [{ id: "acct-1", name: "Urjwan" }]),
  runWithTenant: vi.fn(async (_a: string, _u: string, fn: () => Promise<unknown>) => fn()),
}));

import {
  MCP_UNEXPECTED_ERROR,
  McpToolError,
  runWithMcpActor,
  withBrand,
} from "@/lib/mcp/runtime";
import type { SessionUser } from "@/lib/auth";

const actor = {
  user: { id: "u1", role: "admin", permissions: null, allAccounts: true } as unknown as SessionUser,
  tokenId: "t1",
};
const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;

describe("MCP tool errors (2026-10)", () => {
  it("a raw database error reaches the server log, never the model", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runWithMcpActor(actor, () =>
      withBrand(undefined, async () => {
        throw new Error('relation "performance_records" does not exist');
      }),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toBe(`Error: ${MCP_UNEXPECTED_ERROR}`);
    expect(text(res)).not.toContain("performance_records");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a tool's own McpToolError still speaks to the model", async () => {
    const res = await runWithMcpActor(actor, () =>
      withBrand(undefined, async () => {
        throw new McpToolError('No campaign named "X".');
      }),
    );
    expect(text(res)).toBe('Error: No campaign named "X".');
  });
});
