import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, EDITOR_PRESET, type Permission } from "@/lib/permissions";
import {
  ADMIN_SCOPE,
  TEAM_REFUSAL,
  grantRefusal,
  removeRefusal,
  teamGuard,
  type ManagerScope,
  type MemberAccess,
} from "@/lib/team-guard";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const lead = (perms: Permission[], brands: string[] | "all" = "all"): ManagerScope => ({
  isAdmin: false,
  permissions: perms,
  allAccounts: brands === "all",
  accountIds: brands === "all" ? [] : brands,
});

const member = (over: Partial<MemberAccess> = {}): MemberAccess => ({
  role: "viewer",
  permissions: [],
  allAccounts: true,
  accountIds: [],
  ...over,
});

const LEAD = lead(["users.manage", "creative.edit"]);
const RLEAD = lead(["users.manage", "creative.edit"], [A]);
const ADMIN_MEMBER = member({ role: "admin", permissions: null });

describe("teamGuard — admins pass everything", () => {
  it("every kind, even the ones that refuse everybody else", () => {
    expect(teamGuard(ADMIN_SCOPE, { kind: "invite", role: "admin", allAccounts: true, accountIds: [] })).toBeNull();
    expect(teamGuard(ADMIN_SCOPE, { kind: "access", target: ADMIN_MEMBER, role: "viewer", permissions: null })).toBeNull();
    expect(teamGuard(ADMIN_SCOPE, { kind: "brands", target: ADMIN_MEMBER, allAccounts: false, accountIds: [A] })).toBeNull();
    expect(teamGuard(ADMIN_SCOPE, { kind: "password", target: ADMIN_MEMBER })).toBeNull();
    expect(teamGuard(ADMIN_SCOPE, { kind: "photo", target: ADMIN_MEMBER })).toBeNull();
  });
});

describe("teamGuard — an admin is off limits below admin", () => {
  it("can't be made", () => {
    expect(teamGuard(LEAD, { kind: "invite", role: "admin", allAccounts: true, accountIds: [] })).toBe(TEAM_REFUSAL.makeAdmin);
    expect(teamGuard(LEAD, { kind: "access", target: member(), role: "admin", permissions: null })).toBe(TEAM_REFUSAL.makeAdmin);
  });
  it("can't be touched", () => {
    expect(teamGuard(LEAD, { kind: "access", target: ADMIN_MEMBER, role: "admin", permissions: null })).toBe(TEAM_REFUSAL.adminAccess);
    expect(teamGuard(LEAD, { kind: "brands", target: ADMIN_MEMBER, allAccounts: true, accountIds: [] })).toBe(TEAM_REFUSAL.adminBrands);
    expect(teamGuard(LEAD, { kind: "password", target: ADMIN_MEMBER })).toBe(TEAM_REFUSAL.adminPassword);
    expect(teamGuard(LEAD, { kind: "photo", target: ADMIN_MEMBER })).toBe(TEAM_REFUSAL.adminPhoto);
  });
});

describe("teamGuard — permissions: only what the manager holds", () => {
  it("grants what they hold, refuses what they don't", () => {
    expect(teamGuard(LEAD, { kind: "access", target: member(), role: "viewer", permissions: ["creative.edit", "users.manage"] })).toBeNull();
    expect(teamGuard(LEAD, { kind: "access", target: member(), role: "viewer", permissions: ["audit.view"] })).toBe(grantRefusal("audit.view"));
  });
  it("can't remove what they don't hold, but leaves it alone while changing the rest", () => {
    const auditor = member({ permissions: ["audit.view"] });
    expect(teamGuard(LEAD, { kind: "access", target: auditor, role: "viewer", permissions: [] })).toBe(removeRefusal("audit.view"));
    expect(teamGuard(LEAD, { kind: "access", target: auditor, role: "viewer", permissions: ["audit.view", "creative.edit"] })).toBeNull();
  });
  it("judges a preset by its EFFECTIVE set", () => {
    // Editor preset → null permissions, but it grants the whole EDITOR_PRESET.
    expect(teamGuard(LEAD, { kind: "access", target: member(), role: "editor", permissions: null })).toBe(grantRefusal("creative.create"));
    // A holder of the whole preset may hand it out.
    expect(teamGuard(lead([...EDITOR_PRESET, "users.manage"]), { kind: "access", target: member(), role: "editor", permissions: null })).toBeNull();
    // An explicit set equal to the preset, re-saved as the preset, changes nothing.
    const asCustom = member({ role: "editor", permissions: [...EDITOR_PRESET] });
    expect(teamGuard(LEAD, { kind: "access", target: asCustom, role: "editor", permissions: null })).toBeNull();
  });
  it("a no-op save of someone who holds more is allowed", () => {
    const peer = member({ role: "editor", permissions: null });
    expect(teamGuard(LEAD, { kind: "access", target: peer, role: "editor", permissions: null })).toBeNull();
  });
  it("invite is judged by the preset it hands out", () => {
    expect(teamGuard(LEAD, { kind: "invite", role: "viewer", allAccounts: true, accountIds: [] })).toBeNull();
    expect(teamGuard(LEAD, { kind: "invite", role: "editor", allAccounts: true, accountIds: [] })).toBe(grantRefusal("creative.create"));
  });
  it("every refusal names the catalog label, never a key", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(grantRefusal(p)).not.toContain(p);
      expect(removeRefusal(p)).not.toContain(p);
    }
  });
});

describe("teamGuard — brands: a restricted manager stays inside their own", () => {
  it("an every-brand manager may grant anything", () => {
    expect(teamGuard(LEAD, { kind: "brands", target: member({ allAccounts: false, accountIds: [A] }), allAccounts: true, accountIds: [] })).toBeNull();
    expect(teamGuard(LEAD, { kind: "invite", role: "viewer", allAccounts: false, accountIds: [B] })).toBeNull();
  });
  it("never 'every brand'", () => {
    expect(teamGuard(RLEAD, { kind: "invite", role: "viewer", allAccounts: true, accountIds: [] })).toBe(TEAM_REFUSAL.grantEveryBrand);
    expect(teamGuard(RLEAD, { kind: "brands", target: member({ allAccounts: false, accountIds: [A] }), allAccounts: true, accountIds: [] })).toBe(TEAM_REFUSAL.grantEveryBrand);
  });
  it("grants and removes only their own brands", () => {
    expect(teamGuard(RLEAD, { kind: "invite", role: "viewer", allAccounts: false, accountIds: [A] })).toBeNull();
    expect(teamGuard(RLEAD, { kind: "invite", role: "viewer", allAccounts: false, accountIds: [B] })).toBe(TEAM_REFUSAL.grantBrand);
    const split = member({ allAccounts: false, accountIds: [A, B] });
    expect(teamGuard(RLEAD, { kind: "brands", target: split, allAccounts: false, accountIds: [B] })).toBeNull(); // A is theirs
    expect(teamGuard(RLEAD, { kind: "brands", target: split, allAccounts: false, accountIds: [A] })).toBe(TEAM_REFUSAL.removeBrand);
    const bOnly = member({ allAccounts: false, accountIds: [B] });
    expect(teamGuard(RLEAD, { kind: "brands", target: bOnly, allAccounts: false, accountIds: [A, B] })).toBeNull();
  });
  it("leaves an every-brand member alone (a no-op passes)", () => {
    const open = member({ allAccounts: true });
    expect(teamGuard(RLEAD, { kind: "brands", target: open, allAccounts: false, accountIds: [A] })).toBe(TEAM_REFUSAL.everyBrandMember);
    expect(teamGuard(RLEAD, { kind: "brands", target: open, allAccounts: true, accountIds: [] })).toBeNull();
  });
});

describe("teamGuard — password: only for someone within the manager's access", () => {
  it("within → allowed", () => {
    expect(teamGuard(LEAD, { kind: "password", target: member({ permissions: ["creative.edit"] }) })).toBeNull();
    expect(teamGuard(RLEAD, { kind: "password", target: member({ allAccounts: false, accountIds: [A] }) })).toBeNull();
  });
  it("more permissions → refused", () => {
    expect(teamGuard(LEAD, { kind: "password", target: member({ role: "editor", permissions: null }) })).toBe(TEAM_REFUSAL.passwordBeyond);
  });
  it("more brands → refused", () => {
    expect(teamGuard(RLEAD, { kind: "password", target: member({ allAccounts: true }) })).toBe(TEAM_REFUSAL.passwordBeyond);
    expect(teamGuard(RLEAD, { kind: "password", target: member({ allAccounts: false, accountIds: [A, B] }) })).toBe(TEAM_REFUSAL.passwordBeyond);
  });
});

describe("teamGuard — photo", () => {
  it("anyone below admin is fair game", () => {
    expect(teamGuard(RLEAD, { kind: "photo", target: member({ role: "editor", permissions: null }) })).toBeNull();
  });
});
