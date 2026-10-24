import { beforeAll, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
const signedIn = { current: true };
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  auth: vi.fn(async () => (signedIn.current ? { id: "11111111-1111-1111-1111-111111111111" } : null)),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { GET } from "@/app/api/palette/route";
import { resetAndSeed } from "./fixtures";

/**
 * D13 (2026-10): the ⌘K creative list moved out of the dashboard layout's
 * every render into `GET /api/palette`, fetched when the palette is first
 * opened. Same rows as before — the active brand's creatives with their
 * product — and nothing for a signed-out caller.
 */
beforeAll(async () => {
  await resetAndSeed();
});

describe("GET /api/palette", () => {
  it("lists the ACTIVE brand's creatives with their product, by name", async () => {
    const body = (await (await GET()).json()) as {
      creatives: Array<{ id: string; name: string; productName: string }>;
    };
    expect(body.creatives.map((c) => [c.name, c.productName])).toEqual([
      ["A-Creative-1", "Product A"],
      ["A-Creative-2", "Product A"],
    ]);
    vi.mocked(getActiveAccountId).mockResolvedValueOnce(ACCOUNT_B);
    const b = (await (await GET()).json()) as { creatives: Array<{ name: string }> };
    expect(b.creatives.map((c) => c.name)).toEqual(["B-Creative-1"]);
  });

  it("refuses a signed-out caller", async () => {
    signedIn.current = false;
    expect((await GET()).status).toBe(401);
    signedIn.current = true;
  });
});
