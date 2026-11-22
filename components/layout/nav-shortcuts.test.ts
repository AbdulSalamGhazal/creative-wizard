import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { ANALYZERS_CHILDREN, NAV_ITEMS, NAV_SECTIONS } from "@/components/layout/nav-items";
import {
  formatKeys,
  shortcutGroups,
  shortcutKey,
  type ShortcutKeyEvent,
} from "@/components/layout/nav-shortcuts";

const ev = (over: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  ...over,
});

const everything = shortcutGroups(ALL_PERMISSIONS);
const flat = everything.flatMap((g) => g.entries.map((e) => `${g.leader}${e.key}`));

describe("the keyboard shortcut map (user-approved 2026-11-22)", () => {
  it("gives every page in the nav a shortcut", () => {
    const pages = NAV_ITEMS.filter((i) => !i.children).length + ANALYZERS_CHILDREN.length;
    expect(flat).toHaveLength(pages);
  });

  it("never gives two pages the same keys, nor two groups the same first key", () => {
    expect(new Set(flat).size).toBe(flat.length);
    const leaders = everything.map((g) => g.leader);
    expect(new Set(leaders).size).toBe(leaders.length);
  });

  it("each page's first key is its group's", () => {
    for (const s of NAV_SECTIONS) {
      for (const i of NAV_ITEMS.filter((n) => n.group === s.key && n.keys)) {
        expect(i.keys!.length, i.label).toBe(2);
        expect(i.keys![0], i.label).toBe(s.shortcut);
      }
    }
    for (const c of ANALYZERS_CHILDREN) expect(c.keys[0], c.label).toBe("t");
  });

  it("is the approved map", () => {
    const map = Object.fromEntries(
      everything.flatMap((g) => g.entries.map((e) => [`${g.leader}${e.key}`, e.href])),
    );
    expect(map).toMatchObject({
      gd: "/",
      gc: "/campaigns",
      bt: "/budget",
      bp: "/budget/plan",
      so: "/store/orders",
      pp: "/price-structure/plan",
      am: "/admin/users",
      tc: "/compare",
      tp: "/trends/landing-pages",
    });
  });

  it("a page the viewer can't see has no shortcut", () => {
    const viewer = shortcutGroups([]);
    const keys = viewer.flatMap((g) => g.entries.map((e) => `${g.leader}${e.key}`));
    expect(keys).toContain("bp");
    expect(keys).not.toContain("am");
    expect(keys).not.toContain("gu");
    expect(viewer.some((g) => g.leader === "a")).toBe(false);
  });

  it("Analyzers follows Advertisements as its own group", () => {
    expect(everything.map((g) => g.label)).toEqual([
      "Advertisements",
      "Analyzers",
      "Budget",
      "Store",
      "Pricing",
      "Admin",
    ]);
  });
});

describe("reading a key", () => {
  it("reads letters by physical key, so an Arabic layout works", () => {
    expect(shortcutKey(ev({ key: "لا", code: "KeyB" }))).toBe("b");
    expect(shortcutKey(ev({ key: "P", code: "KeyP" }))).toBe("p");
  });

  it("ignores anything held with ⌘, Ctrl or Alt, and auto-repeat", () => {
    expect(shortcutKey(ev({ key: "k", code: "KeyK", metaKey: true }))).toBeNull();
    expect(shortcutKey(ev({ key: "k", code: "KeyK", ctrlKey: true }))).toBeNull();
    expect(shortcutKey(ev({ key: "b", code: "KeyB", altKey: true }))).toBeNull();
    expect(shortcutKey(ev({ key: "b", code: "KeyB", repeat: true }))).toBeNull();
  });

  it("reads ? and Escape; digits and other keys mean nothing", () => {
    expect(shortcutKey(ev({ key: "?", code: "Slash" }))).toBe("?");
    expect(shortcutKey(ev({ key: "/", code: "Slash" }))).toBeNull();
    expect(shortcutKey(ev({ key: "Escape", code: "Escape" }))).toBe("escape");
    expect(shortcutKey(ev({ key: "1", code: "Digit1" }))).toBeNull();
  });

  it("prints keys the way the list shows them", () => {
    expect(formatKeys("bp")).toBe("B P");
  });
});
