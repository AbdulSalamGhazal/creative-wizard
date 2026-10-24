/**
 * SERVER ACTIONS AND NAVIGATIONS SHARE ONE QUEUE (2026-10, W2-1).
 *
 * Next 15's App Router runs navigations and server actions through a single
 * queue, and a navigation that arrives while a server action is still IN it
 * discards the action's result and marks the queue `needsRefresh`: once the
 * navigation lands, the router fetches the whole destination AGAIN
 * (app-router-instance.js). Two everyday shapes walk straight into it:
 *
 *  - `await` an action, then navigate (create → the new page, delete → the
 *    list, rename → the new URL). The action's promise resolves a few
 *    microtasks BEFORE the router clears it from the queue, so a
 *    `router.push` on the next line still lands inside that window — measured
 *    on a production build: create, rename and delete each fetched the
 *    destination twice.
 *  - fire an action, then navigate at once (open a notification: mark it
 *    read, go to its page; pick a date range: write the URL, remember it).
 *
 * The cure is ordering, one task apart — never a second render:
 *  - `await actionSettled()` between the action and the navigation;
 *  - `afterNavigation(send)` to send a fire-and-forget action once the
 *    navigation is queued first (it then waits its turn behind it).
 *
 * Pinned by `app/actions/action-calls.test.ts`.
 */

/** Resolves once the router has finished with the action just awaited. */
export function actionSettled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Send a fire-and-forget action AFTER the navigation started on this tick. */
export function afterNavigation(send: () => void): void {
  setTimeout(send, 0);
}
