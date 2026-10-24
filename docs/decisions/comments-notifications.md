# Comments & notifications

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- A notification's href goes through the house `safeInternalPath` (no
  `/\host`, no control characters); /notifications' day labels use the SAME
  UTC clock as its grouping (W1-13, 2026-10-23).
- **Producers write notifications INSIDE the transaction of the thing they
  describe** (`notifyRoutes(tx, …)`), or use an `afterWrite(tx, result)` hook.
- Every read and write is self-scoped: `recipient_user_id` = the session user
  AND `account_id` = the active brand. An id alone never identifies a row.
- **Silent by default** — no routes for an event notifies nobody, and the actor
  is always excluded from their own event.
- **Archive, never delete.** Individual notifications are NOT audited; only
  `notify.routes_update` is.
- `categoryForType` is the ONE derivation of a row's category, and knows all
  three families. Add a family there, never a fourth mapping at a call site.
- A comment notifies only by MENTION, REPLY or ANCHOR ACTIVITY, and
  `splitCommentRecipients` gives **one row per person per comment** by priority
  mention > reply > anchor.
- Mentions reach the SERVER as EXPLICIT ids and are never parsed from the
  body there; a non-member mention is REFUSED, not dropped. The COMPOSER
  decides the ids: the picker's picks, plus a whole typed or pasted "@Full
  Name" that matches EXACTLY ONE brand member (`resolveComposerMentions`,
  user decision 2026-10-20) — a name two members share is never guessed.
- **A mention is the WHOLE name.** `findMentions` (lib/comments.ts) — one
  left-to-right pass, longest name first, word edges checked in any script —
  is the ONE matcher for who a submit notifies (`activeMentions`) and what
  the body highlights (`commentHtml`, text only: never inside a tag or a
  link). The picker's "@query" runs through spaces while a member still
  matches it ("@Abdulsalam Ghazal") and closes when none does; a failed
  member list is an error state with Retry, never "Loading…" forever.
- Threads are FLAT — the server re-parents a reply-to-a-reply onto the root.
- Delete is SOFT; `restoreComment` is allowed only for whoever performed the
  delete, checked against the `comment.delete` audit row written in the same
  transaction — keep that row in-transaction or undo silently breaks.
- **Only ADMINS delete someone else's comment** (F3, user decision
  2026-10-24); authors always delete their own. `users.manage` does NOT
  grant it. `canModerateComments` (lib/comments.ts) is the one rule: it gates
  `deleteComment` and is the panel's `canModerate`, so the "…" menu never
  offers a delete the server refuses.
- **`lib/comment-markdown.ts` is the only place user input becomes HTML, and
  its ORDER is the security model**: escape the whole body first, then
  transform. A new pattern goes AFTER the escape, never before.
- A FIRST LOAD never toasts and the bell never shakes on a baseline count;
  `off` silences toasts only — the badge and the tab title still work.
- **Reactions are a FIXED TWELVE** (user decision, 2026-10-20): 👍 👎 ❤️ 🔥 🎉
  😂 😮 😢 🙏 👀 ✅ 💯, declared once in `COMMENT_REACTIONS`. The KEY is stored, so
  keys are schema — the original `up` `heart` `party` `laugh` `wow` never
  change, every key fits varchar(16), a retired key renders as itself.
- Reactions are SET, not toggled (2026-10): the client sends the state the
  reader wants (`setReaction({ on })`) — ON is an insert that does nothing on
  the unique-key conflict (a race cannot duplicate), OFF a delete — so a
  repeat or replay is harmless. Notifying is ADD-ONLY (only an ON that
  actually inserted) and goes to the author alone, ONCE per (reactor,
  comment, emoji) EVER — `notifications.dedupe_key` =
  `reaction:<comment>:<actor>:<kind>` (user decision, 2026-10-20), so a
  remove-then-re-add stays quiet; removing one retracts nothing. The panel is OPTIMISTIC and serialises writes per (comment, kind)
  (`ReactionSync`, lib/reaction-sync.ts), so a burst of clicks ends in the
  state the reader last chose; a failure rolls the pill back with a toast.
- **A deep link WAITS for its thread.** `?comment=<id>` registers a
  `deepLinkId` that the panel's resets (mount, anchor registration) never
  touch; `deepLinkStep` turns it into the highlight once a loaded thread
  contains it (reloading once if the thread predates the comment), then the
  param is dropped from the URL (`history.replaceState`, no server render).
  The highlight still clears on your own post and on a real anchor change.
- **`?comment=` is never part of a view**: stripped when the view is captured
  (`stripCommentParam`, client AND `viewQuerySchema`), and ignored by
  `normalizeQuery`, so the "Open this view" chip never offers a deep link.
- **Comment and notification actions call NO `revalidatePath`/`revalidateTag`**
  (pinned by `app/actions/comment-latency.test.ts`): a revalidation inside a
  server action re-renders the CALLER's page and ships it in the response,
  and these surfaces live on every page. Nothing server-side reads comments;
  `/notifications` is `force-dynamic` and refreshes itself on
  `NOTIFICATIONS_CHANGED_EVENT`, which the bell announces after a write (and
  the page announces back, so the badge follows without a second timer).
- **Every client call to a comment, reaction or notification action goes
  through `safeAction`** (lib/action-failure.ts) and fails through
  `toastActionFailure` (lib/action-toast.ts): a REJECTED call — a network
  blink, or a tab from before the last deploy calling an action id the new
  server doesn't know — becomes a toast, never an unhandled rejection or the
  route's error boundary. Deploy skew says the app was updated and offers
  Reload. (Since W2-2, 2026-10, this is the HOUSE rule for every action call —
  ui-system.md — and the comment panel's own thunks are wrapped lexically,
  like everyone else's.)
- **ONE background call per navigation** (W2-7, 2026-10): the bell's
  navigation load asks `/api/notifications?anchorType=&anchorId=` for the
  page's comment count too, and hands it to the toggle's badge — the chrome
  used to fire two requests beside every page render. Polls, focus reloads
  and change events fetch the feed alone. `POLL_MS` is still the one polling
  knob, at 30 s (D17).
- **The panel's code loads lazily** (W2-8, 2026-10): `comment-panel.tsx` is
  the eager half (state, toggle, the dock's frame); `comment-drawer.tsx` (the
  thread, composer, reactions, mention picker) arrives through `next/dynamic`,
  preloaded when the browser is idle or the pointer/focus reaches the toggle,
  so a first open stays instant without it being in every page's download.
- **The toast setting reaches the bell without a render** (W2-1, 2026-10):
  `setToastScope` revalidates nothing; the account menu announces the new
  value on `TOAST_SCOPE_CHANGED_EVENT` (lib/notifications.ts) and the bell
  obeys it at once. The next full render reads it from the row.
- **ONE avatar.** `UserAvatar` (components/user/user-avatar.tsx): the photo
  (`users.avatar_url`) when there is one and it loads, otherwise coloured
  initials (`lib/avatar.ts`, first + last word). Comment rows, the bell,
  /notifications, the mention picker, the account menu and the Team page all
  use it — never a second avatar.
- **Profile photos have ONE writer** (`writeAvatar`): only URLs we stored,
  the replaced file discarded, every change audited (`user.avatar_update`,
  `meta.self`). Yours from the account menu (no id travels); anyone's on the
  Team page behind `users.manage` — and, below admin, never an admin's
  (`teamGuard`, D1; see tenancy-auth.md).
- **Opening the bell = seen** (user decision, 2026-10-20). It LISTS every
  unread item up to `BELL_UNREAD_CAP` (newest read ones fill to
  `BELL_RECENT_LIMIT`), so opening it marks read exactly what it showed —
  one bounded, self-scoped `markNotificationsRead({ ids })`; those items keep
  a "new" look for that open; unread beyond the cap stays unread ("+N more").
  The toast pointer is per USER and brand.
- **A thread on screen has been read.** When the panel shows an anchor,
  `markThreadRead` snapshots `comment_reads.last_read_at` (the "New"
  divider's baseline — a first visit has none), moves it to now, and marks
  your comment notifications on that anchor read — one request, one
  transaction, self- and account-scoped; the bell follows through
  `NOTIFICATIONS_CHANGED_EVENT`. Your own comments are never "new".
- **Direction is per message, chrome stays LTR.** The composer, every
  rendered paragraph/list/item, previews and the reply quote are
  `dir="auto"`; names and @mentions are isolated (`<bdi>`); links are
  `dir="ltr"`. Notification titles are English templates: producers wrap
  every user-supplied part in U+2068/U+2069 (`isolate`, lib/bidi.ts — written
  as escapes, never raw) and titles render LTR; search ignores the isolates.
- **Inside a producer's transaction, every read goes through the `tx`** —
  never the global `db`, never a helper that defaults to it
  (`resolveAnchorPath(…, tx)`). Production's pool is ONE connection, so a `db`
  query inside `db.transaction` waits forever; the DB suite runs at
  `DB_POOL_MAX=1` to catch it.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Notifications (phases 1–2, comments, reactions)

<!-- was CLAUDE.md L230–425 -->

- **Notifications (2026-09, phase 1 — the spine). Five invariants, all
  deliberate.** Per-user in-app notifications: a top-bar bell, `/notifications`
  (no sidebar entry — the bell is the way in), and routing configured on
  Configuration → Notifications. Migration **0043** (additive: `notifications`
  + `notification_routes`).
  1. **Producers write INSIDE the transaction of the thing they describe.**
     `notifyRoutes(tx, accountId, eventType, {...})` takes the caller's `tx`, so
     a notification can never outlive a rolled-back write. Where a query helper
     owns the transaction, give it an `afterWrite(tx, result)` hook (see
     `writeStoreBatch`) instead of opening a second one. One routes read + one
     bulk insert per producer — `lib/db.ts` is `max: 1`.
  2. **Self-scoping on every notification read and write:**
     `recipient_user_id = the session user` AND `account_id = the active brand`.
     An id alone never identifies a row; someone else's simply matches nothing.
     Reading your own needs NO permission — `notify.manage` gates the ROUTING
     config only. Pinned by tests/db/notifications.test.ts.
  3. **Silent by default.** No `notification_routes` rows for an event = it
     notifies nobody, and the actor is always excluded from their own event.
  4. **Archive, never delete.** "Clear" sets `archived_at`; restore reverses it;
     archived rows stay searchable in the Archived tab. Nothing hard-deletes.
  5. **Individual notifications are NOT audited** (they'd mirror `audit_events`
     row for row); only `notify.routes_update` is.
  - **NOTICEABLE (2026-09, migration 0050) — three escalations, all fed by the
    bell's EXISTING poll: no second timer, no second endpoint.**
    - **ARRIVAL TOASTS.** Each poll diffs its feed against `lastToastedId`, a
      per-BRAND pointer in this browser's localStorage (guarded reads/writes —
      a private window or blocked storage must not break the bell). **A FIRST
      LOAD NEVER TOASTS**: a null pointer just adopts the newest id, because
      opening the app is not an event; only what arrives while it is open is.
      A pointer that has fallen out of the feed window reads as "all of these
      are new", which the burst rule then collapses. More than
      `TOAST_BURST_LIMIT` (3) arrivals in one poll become ONE summary toast
      ("4 new notifications" → /notifications) instead of a stack; at or below
      it, one toast each, oldest first, with the actor as the description and
      an Open action that runs the same mark-read-then-navigate flow the
      popover does. An item already read elsewhere never toasts.
    - **TOAST SCOPE — a per-user setting (`users.toast_scope`), default
      `personal`** (user decision), in the avatar menu's Notifications submenu
      (the Theme submenu's shape). `personal` = a mention or a reply, or a
      DIRECT event (one natural recipient — `user.brand_granted`), derived by
      `isPersonalNotification`, never a second hand-kept list. `all` = every
      notification; `off` silences **toasts only** — the badge, the tab title
      and the bell still work, because not being interrupted is different from
      not being told. The action is self-only (the session user is the
      subject; there is no id in its input), validated against the vocabulary,
      and NOT audited — preference churn, like notification reads.
    - **TAB TITLE + BELL.** Unread prefixes `document.title` with "(N) "
      (capped "9+", `titleWithUnread`); it re-applies after route changes
      (Next rewrites the title on navigation) and ALWAYS strips an existing
      prefix first, so counts can never stack. The bell shakes ONCE when the
      count INCREASES — never a persistent animation, keyframes behind
      `prefers-reduced-motion`, and the FIRST loaded count is a baseline, not
      an increase (arriving at a page with unread items must not shake, for
      the same reason it must not toast).
  - **THE PAGE READS LIKE A FEED (2026-10):** DAY GROUPS (Today · Yesterday ·
    the date, labelled in UTC like every other date here), an actor AVATAR
    (initials + a colour derived from the name, `lib/avatar.ts`) carrying the
    category glyph, and a BURST COLLAPSE — consecutive same-anchor rows within
    one day fold into "5 updates on «anchor»", expandable, with mark-read
    acting on the GROUP. The grouping is pure (`groupNotifications`): runs must
    be CONSECUTIVE (an unrelated row breaks one — the feed stays
    chronological), never cross a day, and a single row is never wrapped.
    Category glyphs live in the SAME map as the filter icons
    (`filter-icons.ts` → `CATEGORY_ICONS`), so the app has one place that
    decides what a concept looks like. Row actions appear on hover/focus and
    are always visible where there is no hover — the comment menu's precedent.
    Tabs, search, filters and pagination are unchanged.
  Vocabulary is `lib/notifications.ts` and everything derives from it —
  `EVENT_TYPES` (the routable catalog; the config tab's rows), the five
  categories (phase 1 produces `system` only), `POLL_MS` (the ONE polling knob),
  `safeHref` (an href is data: in-app paths only, never an open redirect).
  `notifications.dedupe_key` is RESERVED for phase-3 alert upserts — its unique
  index is partial so today's NULLs never collide. **`categoryForType` is the
  ONE derivation of a row's category** and knows all three families: the
  routable catalog, the DIRECT events, and the COMMENT events
  (`COMMENT_EVENT_TYPES`). It missed the last of those until 2026-09, so every
  mention and reply rendered as a "System" chip in the bell and on the page —
  a stored `category` column that nothing read. Add a family here, not a
  fourth mapping at a call site. See tech-spec §5f.
  - **Phase 2 — comments, mentions, replies (2026-09, migration 0044).**
    Anchors: creative · campaign · budget month · an allow-listed aggregate
    page (`COMMENTABLE_VIEWS` in lib/comments.ts). Invariants, all deliberate:
    (a) **every comment captures the commenter's current view** — the query
    string, read from the LIVE location at post time, so a deep link reproduces
    what they were looking at; (b) a comment notifies ONLY by mention or reply
    — a top-level comment with no mentions reaches nobody, and **mention wins**
    so one comment never produces two rows for one person; (c) mentions are
    stored EXPLICITLY from the picker, never parsed out of body text, and a
    non-member mention is REFUSED, not dropped; (d) threads are FLAT — the
    server re-parents a reply-to-a-reply onto the thread's root; (e) `anchor_id`
    has no FK, so the action re-validates the anchor account-scoped and
    allow-lists `view` pathnames; (f) delete is SOFT (the row renders "Comment
    deleted" so replies keep their place), edit is author-only, admins may
    delete anyone's; (g) notification links go through **`/go/comment/[id]`**,
    which resolves the anchor at CLICK time — creatives and campaigns are
    addressed by name, so a stored link would rot on the next rename.
    `comment.update`/`comment.delete` are audited; creation is not.
    - **Relocated to GLOBAL CHROME (2026-09) — a DOCKED panel, not a modal.**
      ONE surface: the top-bar comment icon TOGGLES a 380px `<aside>` in the
      dashboard layout's content row, beside the page column (`flex-1 min-w-0`).
      The page SQUEEZES and stays fully interactive — no backdrop, no focus
      trap, no scroll lock; clicking the page never closes it. It PERSISTS
      across navigation (shows each page's thread; a quiet "no comments here" on
      anchor-less pages), open state in localStorage. **Below `lg` it falls back
      to the full-width overlay Sheet** — don't dock on a phone. No per-page
      panels or header buttons (removed). Chat order (oldest top, newest bottom,
      composer pinned below, scrolled to the end on open). **Clicking a comment
      that carries a view APPLIES that view to the page beside the panel**, which
      stays open — the panel is a set of saved states, and this is the point of
      capturing the view at all. Reply is the only visible row action; Edit and
      Delete live behind a "…" menu. **Delete = UNDO toast (8s), never a
      confirm**: `restoreComment` is allowed ONLY for whoever performed the
      delete (author, or the admin who removed it), checked against the
      `comment.delete` audit row that `deleteComment` writes INSIDE its own
      transaction — keep that row in-transaction or undo silently breaks.
      **Inline @**: typing "@" at text start or after whitespace opens the picker
      (never mid-word or in an email); mentions stay explicit ids, never parsed
      at submit. Anchors come
      from a client `CommentAnchorProvider` in the dashboard layout: an entity
      page renders `<CommentAnchor type id />` and WINS on its own pathname,
      everything else derives a `view` anchor from the pathname, and a page with
      neither hides the icon. Valid view paths DERIVE from `NAV_ITEMS` (admin
      included, `/notifications` excluded) — never re-list them. `/go/comment`
      lands with `?comment=<id>`, which opens the panel on that comment.
    - **ANCHOR-FOLLOWING (2026-10, user decision).** A new TOP-LEVEL comment
      also notifies everyone who has commented on that ANCHOR before (any
      thread on it) — type `comment.anchor_activity`, category `reply`, worded
      "«Actor» commented on «anchor» — where you commented". A REPLY still
      reaches its own thread only: pinging every past commenter on the page for
      a reply is noise. Recipients derive from the `comments` table itself (one
      bounded `SELECT DISTINCT` inside the create transaction) — **no new
      storage, no subscription table**.
      - **ONE ROW PER PERSON PER COMMENT, by priority: mention > reply >
        anchor activity** (`splitCommentRecipients`). Someone mentioned in a
        comment that also replies to their thread on an anchor they follow gets
        exactly ONE notification — the mention. The actor never hears about
        their own comment.
      - **Comment notifications are stamped with the ANCHOR** (`entity_type` /
        `entity_id`), not the individual comment — the comment id already rides
        in the href, and the anchor is what lets /notifications collapse "5
        updates on «Hero v2»" into one row. Rows written before 2026-10 carry
        the comment and simply never group.
    - **ONE COMPOSER — create, reply AND edit (2026-10).** The edit path used
      to be a bare `<Textarea>` beside the real composer, which is exactly why
      typing "@" while editing did nothing: the picker, the keyboard handling
      and the mention registration all lived in the composer. The fix is
      STRUCTURAL — `CommentComposer` takes a value, a submit label and what
      submitting MEANS, and all three callers use it — rather than a second
      copy of the wiring that would drift again.
      - **An edit can ADD a mention**, so `updateComment` takes the mention set
        as it stands after the edit, diffs it, and notifies the NEW names only,
        in the same transaction as the body write. **Removing a mention drops
        its row but RETRACTS NOTHING** — you cannot un-tell someone, and the
        notification they already received stays.
      - **MARKDOWN-LITE (user-approved scope): bold, italic and `- ` bullet
        lists. Nothing else — and LINKS ARE NOT MARKDOWN** (a bare http(s) URL
        auto-links with `rel="noopener noreferrer nofollow"`; a markdown link
        stays literal text, which is how `[x](javascript:…)` is refused).
        Comments are stored as PLAIN TEXT; `lib/comment-markdown.ts` renders
        them, and **it is the only place in the app that turns user input into
        HTML**. ITS ORDER IS THE SECURITY MODEL: escape the whole body FIRST,
        then transform — so a new pattern goes AFTER the escape, never before,
        and is matched against escaped text. `CommentBody` is the one component
        that sets that HTML. The toolbar (B · I · list · @, ⌘/Ctrl+B/I) only
        INSERTS SYNTAX around the selection — the field never becomes a rich
        editor, so what you see in the box is what is stored.
    - **The composer CLEARS ITSELF on success — and only on success (2026-10,
      user-reported).** The drawer's create composer stays MOUNTED after a post
      (its `key` only changes when `replyTo` does), so the sent text used to sit
      in the box; reply and edit only looked right because those instances
      unmount. The rule is `composerStateAfterSubmit` (pure, pinned both ways):
      success empties body AND mentions, a FAILED submit keeps every character —
      losing a typed comment to a network blink is the worse bug. Fix state in
      the COMPOSER, never with a `key` trick at one caller. The same sweep found
      the drawer's `highlightId` was never cleared: it outlived the post (so the
      thread scrolled to someone else's comment instead of yours) and the page
      (so the next thread didn't scroll at all). It is cleared on post and on
      anchor change.
    - **REACTIONS (2026-10, migration 0052) — five kinds, and the toggle is the
      unique key.** 👍 `up` · ❤️ `heart` · 🎉 `party` · 😂 `laugh` · 😮 `wow`,
      declared ONCE as `COMMENT_REACTIONS` in lib/comments.ts and derived
      everywhere; **the short KEY is stored, so the keys are effectively schema**
      (the emoji is presentation, and a retired kind renders as its raw key).
      `toggleReaction` deletes first and inserts only if nothing was removed, so
      a second click takes yours back and a race can't duplicate a row; the
      comment is re-validated ACCOUNT-SCOPED, a soft-deleted comment is refused,
      and the kind is checked against the vocabulary. Membership is the only
      permission, and it is NOT audited (preference churn, like reads).
      **Notifying is ADD-ONLY and goes to the AUTHOR alone** (user decision,
      "like a reply"): type `comment.reaction`, category `reply`, anchor-stamped
      like every comment notification, through `/go/comment/[id]`. Reacting to
      your own comment notifies nobody; REMOVING one retracts nothing. Tallies
      ride the EXISTING thread payload (one bounded query for the thread, never
      one per comment) with `mine` resolved server-side; a deleted comment
      carries none, and editing never touches reactions.

### Phase 1 bug sweep (2026-10-20)

- **A1 — reactions hung in production.** `toggleReaction` looked up the
  anchor's label with `resolveAnchorPath`, which queried through the global
  `db`, INSIDE `db.transaction(...)`. Production's `lib/db.ts` is `max: 1`:
  the transaction held the only connection and the lookup waited for it
  forever, so every reaction on a creative or campaign comment hung until the
  function was killed (view and budget-month anchors resolve without a query,
  which is why "sometimes they simply don't work"). Dev's pool of 10 and the
  DB suite never showed it. Fix: `resolveAnchorPath` takes an `exec` and the
  reaction passes its `tx`. Guard: `lib/db.ts` honours `DB_POOL_MAX`, the DB
  suite sets it to `1` (production size), and `tests/db/pool.test.ts` pins
  both the setting and the mechanism; the reaction test timed out at 5 s on
  the old code and passes on the new. Every DB test file was then run alone at
  pool 1 — no other deadlock surfaced — and a static sweep of every
  `db.transaction` callback found no other `db` use or tenant/auth lookup
  inside one.
- **A2 — every comment action re-rendered the whole page.** `createComment`,
  `updateComment`, `deleteComment`, `restoreComment` and `toggleReaction` each
  called `revalidatePath` on /library, /campaigns and /budget; any
  revalidation inside a server action makes Next re-render the CURRENT route
  and ship it in the action response, so a 👍 on a creative page waited for
  that whole page. Measured on `/library/[name]` (dev server, warm, local
  data): the action's response was ~185 KB of RSC payload and took a median
  ~172 ms; after removing it, 89 bytes and ~77 ms. A post also ran
  `router.refresh()` — a SECOND full render (~185 KB, 139–360 ms) — now gone:
  median Enter→comment-visible went ~436 ms → ~382 ms, the rest being the
  thread's own `/api/comments` reload (dev's per-request floor is ~245 ms).
  The bell's `markNotificationRead` did the same with `/notifications`;
  `revalidateNotifications` is gone too, replaced by
  `NOTIFICATIONS_CHANGED_EVENT` (`announceNotificationsChanged` /
  `onNotificationsChanged` in lib/notifications.ts): the bell announces,
  /notifications refreshes itself only while it is on screen, and the bell
  reloads when the page reads or clears something.
- **A8 — a thrown action call failed invisibly (or took the page down).**
  Each action returns `{ ok: false, error }` for what it can catch, but the
  CALL can reject before the action runs: a network blink, or — several times
  a day here, because `main` auto-deploys — a stale tab whose action id the
  new deployment doesn't know (Next throws `UnrecognizedActionError` on the
  client after a 404 with `x-nextjs-action-not-found`). Inside
  `startTransition` that rejection reached the route error boundary; in the
  bell it vanished. Now every call site in the composer, the thread (delete,
  undo), reactions, the bell, /notifications and the toast-scope setting runs
  through `safeAction`, which resolves to a failure result, and
  `toastActionFailure` says what happened — "Wizard was updated — reload."
  with a Reload button (and a close button: it never times out) for deploy
  skew
  (detected by the error's name or Next's wording, not by Next's `unstable_`
  helper), a connection sentence for a network failure, the generic sentence
  otherwise.
- **A3 — reactions gave no feedback, and a double click undid itself.**
  Nothing moved until the server answered (~0.4 s locally), and a second
  click in that window sent a second TOGGLE. The contract is now SET:
  `setReaction({ commentId, kind, on })` replaces `toggleReaction` — ON is
  `insert … on conflict do nothing returning`, so only a row that was really
  added notifies (a repeated ON, two tabs, or a replay tell the author once),
  OFF is a delete; the account-scoped comment check, the deleted-comment
  refusal and the vocabulary check are unchanged. On the client, ONE
  `useCommentReactions` per thread lays the reader's pending choices over the
  server's tallies (`applyReactionOverrides`, pure) so the pill, the count and
  the tint change on the click, and `ReactionSync` keeps at most one request
  in flight per (comment, kind): a burst of on/off/on/off sends at most two
  requests and ends where the reader stopped. A failure rolls the pill back
  to the last state the server confirmed (not to stale tallies) and toasts.
  The picker closes on the pick. After writes settle the thread reloads once
  (debounced 300 ms) to bring back other people's reactions and the tooltip
  names. Measured (dev, warm): click→pill ~405 ms → ~50 ms (dev-mode React
  render; the request now runs behind it).
- **A3 (posting) — a post took ~0.4 s to appear** even after A2 (the
  thread's own reload is most of it), so a post now shows AT ONCE as a
  pending row — yours, dimmed, "Sending…", no actions — until the reload
  brings the stored row that replaces it (`ThreadComment.pending`, the
  drawer's `pending` list). The composer still clears on success only
  (`composerStateAfterSubmit`), and a failed or rejected post drops the
  placeholder and keeps every character. The composer's submit moved OUT of
  `useTransition`: an update made inside an async transition only commits
  when the whole call finishes, which held the pending row back for the
  length of the request. Measured (dev): Enter→row visible ~382 ms → ~25 ms
  on a short thread (~120 ms on a 45-comment one — dev-mode React rendering
  the whole thread).
- **A4 — Enter posted twice.** The textarea's Enter called `submit()` even
  while a post was in flight (only the Send button was disabled). A ref
  guard now admits ONE submit at a time — a state flag alone can't stop two
  Enters landing before React re-renders — and an Enter that belongs to an
  IME mid-composition (`isComposing`, or Safari's keyCode 229) never submits
  or picks a mention (`enterSubmits` / `isImeKeydown` in lib/comments.ts,
  pure and tested). Verified in the browser: three Enters (two in one tick)
  posted exactly one comment, four times out of four; an IME Enter posted
  nothing and kept the text.
- **A5 — mentions failed silently.** (1) `detectMentionQuery` ended the token
  at the first space, so typing a full name closed the picker halfway; the
  name went in as plain text and nobody was told. The token now runs through
  spaces while at least one member still matches (bounded by
  `MENTION_QUERY_MAX`, never across a line, never "@ "), stays open while the
  list is still loading (`members === null`, so a pasted "@Ann Lee" works)
  and closes cleanly when nobody matches; a pick dismisses its own token so
  the inserted "@Name " doesn't reopen the picker. (2) A non-OK member fetch
  left "Loading…" forever (and a throw showed "Nobody matches"): now an error
  line with Retry, and the fetch is no longer cancelled when the picker
  closes mid-request. (3) `activeMentions` was `body.includes("@" + name)`:
  with "Ali" and "Ali Hassan" both picked, deleting "@Ali" still notified Ali
  through "@Ali Hassan", and "@Alice" counted as Ali. `commentHtml` replaced
  one name at a time, so "@Ali" nested inside an already-wrapped "@Ali
  Hassan", matched inside "@Alice", and could write a span into a link's
  href ("…?u=@Ali"). Both now use `findMentions` — one pass, longest first,
  `[\p{L}\p{M}\p{N}_]` word edges (Arabic included), no "@" after a word
  character, "/" or "@" — and the renderer only marks text outside tags and
  links. (4) `initialsOf` took a word's first CHARACTER ("Salam (seed admin)"
  → "S(") and let two Arabic initials join into one glyph; it now takes the
  first letter or digit and keeps Arabic initials apart with U+200C. The top
  bar's private copy of the rule is gone — it uses `initialsOf`.
  `lib/mentions-a5.test.ts` holds the cases; 9 of them failed on the old
  code, including the Arabic and mixed-script ones.
- **A6 — a notification link lost its comment.** `DeepLinkOpener` wrote the
  id into `highlightId`, and `CommentPanelBody`'s "new conversation" effect
  set it back to null — when the panel mounted after being opened, and again
  when the entity page's `<CommentAnchor>` registered (anchor null →
  creative). You arrived from a notification and landed at the bottom with
  nothing highlighted. The opener now only registers a `deepLinkId` (panel
  state the resets don't touch); `deepLinkStep` (pure, tested) highlights it
  once a loaded thread contains it, or reloads ONCE when the thread on
  screen predates the comment (a notification about the page you're already
  on). Once shown, `?comment=` is dropped from the URL with the History API
  (judgment call: a reload or Back no longer replays an old deep link, and
  clicking the same notification again re-highlights; nothing re-renders on
  the server). It passes `null` as the history state, as Next documents:
  passing the current `history.state` marks the call Next-internal, the
  router keeps the stale URL, and (seen in the walk) the sidebar's active
  item went stale with it. Same pass: the thread scrolled with `scrollIntoView`, which
  moves every scrollable ancestor — the page beside the panel too — against
  the ui-system rule; it now sets the panel box's own `scrollTop`, and only
  when something moved the reader (first load, a new comment, a new
  highlight), so a reaction's reload no longer yanks the thread to its end.
  A thread that fails to load says so with Retry instead of "Loading…"
  forever.
- **A7 — `?comment=<id>` leaked into new comments' saved view.** The view is
  captured from `window.location.search`, which still held `comment=` after
  a deep link, so the NEW comment's view re-highlighted the OLD one.
  `stripCommentParam` removes it at capture (keeping every other param
  verbatim), `viewQuerySchema` strips it server-side for stale clients,
  `normalizeQuery` ignores it (so `showViewChip` never offers a "view" that
  is only a deep link), and `buildCommentTarget` already overrode it — a
  test pins that an old comment which stored one still links to itself.
- **Failure wording is SHORT (user decision, 2026-10-20):** "Wizard was
  updated — reload." (with Reload), "Can't reach the server.", "Couldn't load
  people" + Retry, "Couldn't load comments" + Retry, "Sending…". The longer
  first drafts explained what the reader could already see.
- **R2 (review, 2026-10-20) — the mention list's Retry was mouse-only**
  (`onMouseDown`). Focus lives in the textarea while the picker is open, so
  the error row is now the list's active option: Enter or Tab in the
  textarea retries, and the button retries on click (so a focused button and
  a pointer both work) while its mousedown still keeps the caret.
- **R1 (review, 2026-10-20) — a sent post VANISHED when the reload after it
  failed.** `load().finally(drop)` removed the placeholder whether or not the
  stored copy made it to screen, and with rows already on screen no Retry
  showed. Now the row, once the server has it, takes the stored id and drops
  "Sending…" (`markPostSent`), and leaves only when a SUCCESSFUL load
  contains that id (`settleSentPosts`) — both pure and tested. A refresh that
  fails while a thread is on screen shows a quiet "Couldn't load comments ·
  Retry" line above the composer.
- **D3 — initials are FIRST + LAST word, every script (user decision,
  2026-10-20):** "Mary Jane Watson" → "MW", «عبد السلام غزال» → «ع + ZWNJ + غ» (the
  ZWNJ stays), one word → one letter. It was the first two words.
- **D2 — re-adding a reaction notified the author again (user decision,
  2026-10-20: once per reactor, comment and emoji, ever).** The walk produced
  four "reacted 👍" rows from one person's on/off clicking. Reaction
  notifications now carry `dedupe_key = reaction:<comment>:<actor>:<kind>`
  and `createNotifications` inserts keyed rows with `ON CONFLICT (account_id,
  dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING` — the existing PARTIAL
  unique index, so unkeyed rows (every other notification) never collide.
  The key was RESERVED for phase-3 alert upserts; it is shared now, so every
  producer namespaces its keys. Scope: unique per BRAND, recipient-agnostic —
  fine here because a reaction key implies its recipient (the comment's
  author). DB tests: add → remove → add → remove → add plus a second emoji
  and a second reactor = exactly three notifications; ordinary replies keep
  NULL keys and both arrive.
- **D1 — a typed full name is recognised (user decision, 2026-10-20).**
  Typing or pasting "@Ali Hassan" without touching the picker used to leave
  plain text that notified nobody. The composer now resolves every whole
  "@Name" (`findMentions` over the picks AND the member list, longest name
  first) to the PICKED member(s) with that name, else to the ONE member whose
  name it is exactly, else to nobody (two members sharing a name are left to
  the picker) — `resolveComposerMentions`, pure. It fetches the member list
  as soon as the text holds an "@" (not only when the picker opens) and
  re-checks before submit, so a name pasted before the list ever loaded
  still counts. "Notifying …" shows the result before sending. The server is
  untouched: explicit ids, a non-member refused out loud — "never parsed"
  stays true THERE. `lib/mentions-d1.test.ts`: exact match, shared name,
  prefix collision, case, Arabic, pasted multi-line text, no list.

### Phase 2 — the conversation, photos, the bell (2026-10-20)

User decisions (binding): real profile photos (self from the avatar menu,
anyone's on the Team page); opening the bell = seen, and a thread on screen
marks its comment notifications read; a fixed twelve reactions; a "New"
marker since your last visit; long threads collapse; RTL per message; the
reply box stays at the bottom but Reply focuses it with a "Replying to «Name»"
quote.

- **Schema (migrations 0055 + 0056, additive).** `users.avatar_url`
  (nullable) and `comment_reads` (one row per user × brand × anchor, unique
  on those four — the read's own index); 0056 adds a PARTIAL index on
  notifications `(recipient, account, entity_type, entity_id) WHERE read_at IS
  NULL` for the thread-open update.
- **Photos.** `POST /api/uploads/avatar` copies the thumbnail route's shape —
  the browser crops the centre square and downscales to a 256 px WebP (a 470
  KB PNG left as 2 KB in the walk), the server verifies magic bytes (the
  sniffer moved to `lib/image-sniff.ts`, shared with thumbnails) — and writes
  through `writeAvatar`. Self: no `userId`, signed in is enough. Admin: a
  `userId` needs `users.manage`. AUDITED both ways (judgment call: a photo is
  identity every colleague sees, like a name; the password precedent audits
  both the self change and the admin reset). Replacing or removing DISCARDS
  the old file (a person's removed photo should not linger on a public host).
  LOCAL dev has no Blob token, so with no token AND `NODE_ENV !==
  "production"` files go to `public/dev-uploads/avatars/` (gitignored) — the
  fallback can never run in production. Plain `<img>`, not next/image: every
  photo is already a tiny square, and the optimizer would add a round trip
  per size. `AVATAR_CHANGED_EVENT` reloads the open thread after a change.
- **The row.** Avatar leading (smaller for replies), NAME · `<time>` (title =
  absolute date; one `useMinuteTick` per surface keeps "3m ago" true) ·
  edited, body below. Headers are NOT merged for consecutive messages by one
  author (judgment call: threads are short, and each comment keeps its
  time). The panel's helper sentence became an ⓘ InfoTip; the empty states
  are one line ending in what to do ("No comments yet. Start one below.").
  The "Open this view" chip reads "View" (eye icon, screen-reader text kept).
- **"New".** `newCommentIds` (pure): others' comments after the snapshot,
  never yours, never deleted or pending. The divider sits above the first in
  display order; new rows get a subtle tint; the thread lands at the divider
  (a third of the way down) when there is one and nothing is highlighted.
- **Collapse + clamp.** `collapseReplies` (pure): more than two replies →
  the latest two + "Show N earlier replies", per root for as long as the
  panel shows the thread; a deep-linked or new reply in the hidden range
  forces it open. Bodies clamp at ~120 px with a fade and Show more/less —
  measured, so the toggle only appears when the text overflows — and the
  highlighted comment is never clamped.
- **Reply.** The chip says "Replying to «Name»" (name isolated) with a
  one-line quote of THAT comment in its own direction, ✕ to cancel; the
  composer remounts per target with `autoFocus`, so the caret is in it at
  once — docked panel and phone Sheet alike. The post still lands under the
  thread's root (flat threads).
- **The bell.** See the invariant. Each item: `NotificationAvatar` (the
  avatar + `CATEGORY_ICONS` glyph — shared with /notifications, whose own
  inline avatar was replaced), the title LTR, a 2-line preview `dir="auto"`,
  a `<time>`, an unread dot. The category CHIP left both surfaces ("show,
  don't label": the glyph says it; screen-reader text keeps the word). The
  tab-title prefix now survives a page refresh (a MutationObserver on
  `<head>` re-applies it — Next rewrites the title on refresh without a
  route change).
- **RTL.** `commentHtml` adds `dir="auto"` to `<p>`, `<ul>`, `<li>` and
  `dir="ltr"` to links — static attributes on tags built after the escape —
  and marks mentions with `<bdi class="cm-mention">`; the list CSS uses
  `padding-inline-start`. Producers isolate names and anchor labels (comment
  events; the brand-grant title). Walked: an Arabic comment, an English one,
  an Arabic name mentioned in English text, an English name in Arabic text,
  an Arabic bullet list, a URL inside Arabic text, Arabic actor names in the
  bell, a toast (DOM-verified) and /notifications.
- **Review fixes (same day): R1–R4, D1–D4** are recorded above under their
  own entries; R4 added `.claude/**` to the ESLint ignores.

### Comment moderation is an admin power (F3, 2026-10-24)

`deleteComment` and the dashboard layout's `canModerate` both let anyone
holding `users.manage` delete other people's comments — a team manager
could remove what a colleague said. The system audit's D1 review raised it
as a decision, and the user decided: only admins delete someone else's
comment. Authors still delete their own,
and undo stays with whoever performed the delete. The two hand-copied
checks became one function, `canModerateComments`, so the menu and the
server cannot drift apart again. Pinned in `tests/db/comments.test.ts`
(a `users.manage` editor is refused, the author and an admin are not);
the case fails on the old rule.
