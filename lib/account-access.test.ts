import { describe, expect, it } from "vitest";
import { allowedAccountIds, resolveActiveAccountId } from "@/lib/account-access";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";
const ALL = [A, B, C]; // display order (oldest first)

describe("allowedAccountIds", () => {
  it("admin sees every brand, ignoring the membership rows", () => {
    expect(
      allowedAccountIds({
        isAdmin: true,
        allAccounts: false,
        allAccountIds: ALL,
        memberAccountIds: [B], // ignored for admins
      }),
    ).toEqual(ALL);
  });

  it("all_accounts user sees every brand (including brands not in memberships)", () => {
    expect(
      allowedAccountIds({
        isAdmin: false,
        allAccounts: true,
        allAccountIds: ALL,
        memberAccountIds: [],
      }),
    ).toEqual(ALL);
  });

  it("restricted user sees only their memberships, in display order", () => {
    expect(
      allowedAccountIds({
        isAdmin: false,
        allAccounts: false,
        allAccountIds: ALL,
        memberAccountIds: [C, A], // out of order — result follows allAccountIds
      }),
    ).toEqual([A, C]);
  });

  it("restricted user with a stale membership to a deleted brand drops it", () => {
    expect(
      allowedAccountIds({
        isAdmin: false,
        allAccounts: false,
        allAccountIds: [A, B], // C was deleted
        memberAccountIds: [A, C],
      }),
    ).toEqual([A]);
  });

  it("restricted user with no memberships sees nothing", () => {
    expect(
      allowedAccountIds({
        isAdmin: false,
        allAccounts: false,
        allAccountIds: ALL,
        memberAccountIds: [],
      }),
    ).toEqual([]);
  });
});

describe("resolveActiveAccountId", () => {
  it("honors the cookie when it names an allowed brand", () => {
    expect(resolveActiveAccountId([A, B], B)).toBe(B);
  });

  it("falls back to the first allowed brand for a disallowed/stale cookie", () => {
    expect(resolveActiveAccountId([A, B], C)).toBe(A); // forged/other brand
    expect(resolveActiveAccountId([A, B], "not-a-brand")).toBe(A);
  });

  it("falls back to the first allowed brand when there is no cookie", () => {
    expect(resolveActiveAccountId([A, B], undefined)).toBe(A);
    expect(resolveActiveAccountId([A, B], null)).toBe(A);
  });

  it("returns null when the user has zero allowed brands (→ No brand access)", () => {
    expect(resolveActiveAccountId([], "anything")).toBeNull();
    expect(resolveActiveAccountId([], undefined)).toBeNull();
  });
});
