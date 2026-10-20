import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * LATENCY GUARD (2026-10). A `revalidatePath`/`revalidateTag` inside a server
 * action makes Next re-render the page the CALLER is on and ship it in the
 * action's response. The comment panel and the bell live on every dashboard
 * page, so each 👍, post or bell click used to wait for the whole page beside
 * it (~185 KB of RSC payload on /library/[name] locally). Nothing server-side
 * reads comments or the bell's feed, so these modules revalidate nothing —
 * the client reloads what it shows, and /notifications refreshes itself on
 * `NOTIFICATIONS_CHANGED_EVENT`.
 */
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("comment and notification writes never re-render the caller's page", () => {
  it.each([
    "app/actions/comments.ts",
    "app/actions/comment-reads.ts",
    "app/actions/notifications.ts",
  ])(
    "%s calls no revalidatePath / revalidateTag",
    (file) => {
      expect(read(file)).not.toMatch(/\brevalidate(Path|Tag)\s*\(/);
    },
  );

  it("the comment panel does not router.refresh() after a post", () => {
    expect(read("components/comments/comment-drawer.tsx")).not.toMatch(/router\.refresh\(/);
  });
});
