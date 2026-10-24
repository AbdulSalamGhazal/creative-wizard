import { beforeEach, describe, expect, it, vi } from "vitest";

const error = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => error(...a) } }));

import { isCallFailure, toastActionFailure } from "@/lib/action-toast";

beforeEach(() => error.mockClear());

describe("toastActionFailure — one voice for a failed action (W2-2)", () => {
  it("a row's failure is a toast with the action's own words, else the fallback", () => {
    toastActionFailure({ ok: false, error: "Brand name taken" }, "Could not rename brand");
    toastActionFailure({ ok: false }, "Could not rename brand");
    expect(error.mock.calls.map((c) => c[0])).toEqual(["Brand name taken", "Could not rename brand"]);
  });

  it("a form shows it inline instead — no toast", () => {
    const inline = vi.fn();
    toastActionFailure({ ok: false, error: "Can't reach the server." }, "Failed to create", { inline });
    expect(inline).toHaveBeenCalledWith("Can't reach the server.");
    expect(error).not.toHaveBeenCalled();
  });

  it("a stale tab ALWAYS gets the persistent Reload toast, on a form too", () => {
    const inline = vi.fn();
    toastActionFailure({ ok: false, error: "Wizard was updated — reload.", stale: true }, "x", {
      inline,
    });
    expect(inline).toHaveBeenCalledWith("Wizard was updated — reload.");
    expect(error).toHaveBeenCalledTimes(1);
    const opts = error.mock.calls[0]![1] as { id: string; duration: number; action: { label: string } };
    expect(opts).toMatchObject({ id: "stale-deployment", duration: Infinity });
    expect(opts.action.label).toBe("Reload");
  });

  it("tells a broken CALL from an action that quietly said no", () => {
    expect(isCallFailure({ ok: false, error: "Can't reach the server." })).toBe(true);
    expect(isCallFailure({ ok: false })).toBe(false);
    expect(isCallFailure({ ok: true })).toBe(false);
  });
});
