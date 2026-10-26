import { describe, expect, it } from "vitest";
import { guardedDestination, type GuardedClick } from "./unsaved-guard";

const HERE = "https://creative.urjwan.com/library/Creative%20A?sort=name";

const click = (over: Partial<GuardedClick> = {}): GuardedClick => ({
  href: "https://creative.urjwan.com/library",
  target: "",
  download: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...over,
});

describe("guardedDestination — which clicks the unsaved-changes guard stops", () => {
  it("an in-app link to another page is guarded, and the destination keeps its query and hash", () => {
    expect(guardedDestination(click(), HERE)).toBe("/library");
    expect(
      guardedDestination(
        click({ href: "https://creative.urjwan.com/library/Creative%20B?sort=name#notes" }),
        HERE,
      ),
    ).toBe("/library/Creative%20B?sort=name#notes");
  });

  it("passes when nothing navigable was clicked", () => {
    expect(guardedDestination(click({ href: null }), HERE)).toBeNull();
    expect(guardedDestination(click({ defaultPrevented: true }), HERE)).toBeNull();
  });

  it("passes a click that opens a new tab or window — the page stays", () => {
    expect(guardedDestination(click({ metaKey: true }), HERE)).toBeNull();
    expect(guardedDestination(click({ ctrlKey: true }), HERE)).toBeNull();
    expect(guardedDestination(click({ shiftKey: true }), HERE)).toBeNull();
    expect(guardedDestination(click({ altKey: true }), HERE)).toBeNull();
    expect(guardedDestination(click({ button: 1 }), HERE)).toBeNull();
    expect(guardedDestination(click({ target: "_blank" }), HERE)).toBeNull();
    expect(guardedDestination(click({ target: "_self" }), HERE)).toBe("/library");
    expect(guardedDestination(click({ download: true }), HERE)).toBeNull();
  });

  it("passes a cross-origin link (beforeunload covers a real leave) and a malformed one", () => {
    expect(guardedDestination(click({ href: "https://example.com/x" }), HERE)).toBeNull();
    expect(guardedDestination(click({ href: "mailto:a@b.c" }), HERE)).toBeNull();
    expect(guardedDestination(click(), "not a url")).toBeNull();
  });

  it("passes a link to the page we are on — a hash jump or a self link", () => {
    expect(
      guardedDestination(
        click({ href: "https://creative.urjwan.com/library/Creative%20A?sort=name#records" }),
        HERE,
      ),
    ).toBeNull();
    expect(
      guardedDestination(click({ href: "https://creative.urjwan.com/library/Creative%20A?sort=name" }), HERE),
    ).toBeNull();
  });

  it("a different query on the same path is a navigation (a filter change re-renders)", () => {
    expect(
      guardedDestination(
        click({ href: "https://creative.urjwan.com/library/Creative%20A?sort=spend" }),
        HERE,
      ),
    ).toBe("/library/Creative%20A?sort=spend");
  });
});
