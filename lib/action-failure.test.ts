import { describe, expect, it, vi } from "vitest";
import {
  OFFLINE_MESSAGE,
  STALE_DEPLOYMENT_MESSAGE,
  UNKNOWN_FAILURE_MESSAGE,
  describeActionFailure,
  isNavigationSignal,
  isStaleDeploymentError,
  safeAction,
} from "@/lib/action-failure";

class UnrecognizedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedActionError";
  }
}

describe("a server action call that REJECTED", () => {
  it("recognises a tab from before the last deploy — by name or by Next's wording", () => {
    expect(
      isStaleDeploymentError(
        new UnrecognizedActionError('Server Action "7f3a" was not found on the server.'),
      ),
    ).toBe(true);
    expect(
      isStaleDeploymentError(
        new Error(
          "Failed to find Server Action. This request might be from an older or newer deployment.",
        ),
      ),
    ).toBe(true);
    expect(isStaleDeploymentError(new Error("boom"))).toBe(false);
    expect(isStaleDeploymentError(null)).toBe(false);
  });

  it("says the app was updated and flags it, so the toast can offer Reload", () => {
    expect(describeActionFailure(new UnrecognizedActionError("x was not found on the server"))).toEqual(
      { ok: false, error: STALE_DEPLOYMENT_MESSAGE, stale: true },
    );
  });

  it("names a network blink in every browser's words, and anything else generically", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(describeActionFailure(new TypeError(message))).toEqual({
        ok: false,
        error: OFFLINE_MESSAGE,
      });
    }
    expect(describeActionFailure(new Error("Unexpected token <"))).toEqual({
      ok: false,
      error: UNKNOWN_FAILURE_MESSAGE,
    });
    expect(describeActionFailure("a string")).toEqual({ ok: false, error: UNKNOWN_FAILURE_MESSAGE });
  });

  it("safeAction never rejects: the action's own result passes through, a throw becomes a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(safeAction(async () => ({ ok: true as const, id: "c1" }))).resolves.toEqual({
        ok: true,
        id: "c1",
      });
      await expect(
        safeAction(async () => ({ ok: false as const, error: "That comment no longer exists." })),
      ).resolves.toEqual({ ok: false, error: "That comment no longer exists." });
      await expect(
        safeAction(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ).resolves.toEqual({ ok: false, error: OFFLINE_MESSAGE });
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a redirect or notFound from an action is a navigation, not a failure", () => {
  it("rethrows Next's navigation signals so the redirect still happens", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/signin;307;",
    });
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(isNavigationSignal(redirect)).toBe(true);
    expect(isNavigationSignal(notFound)).toBe(true);
    expect(isNavigationSignal(new Error("boom"))).toBe(false);
    expect(isNavigationSignal({ digest: 42 })).toBe(false);
    await expect(
      safeAction(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });
});
