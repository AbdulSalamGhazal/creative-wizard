# Comments & notifications

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

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
- Mentions are stored EXPLICITLY from the picker, never parsed from body text;
  a non-member mention is REFUSED, not dropped.
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
- **`lib/comment-markdown.ts` is the only place user input becomes HTML, and
  its ORDER is the security model**: escape the whole body first, then
  transform. A new pattern goes AFTER the escape, never before.
- A FIRST LOAD never toasts and the bell never shakes on a baseline count;
  `off` silences toasts only — the badge and the tab title still work.
- Reactions are SET, not toggled (2026-10): the client sends the state the
  reader wants (`setReaction({ on })`) — ON is an insert that does nothing on
  the unique-key conflict (a race cannot duplicate), OFF a delete — so a
  repeat or replay is harmless. Notifying is ADD-ONLY (only an ON that
  actually inserted) and goes to the author alone; removing one retracts
  nothing. The panel is OPTIMISTIC and serialises writes per (comment, kind)
  (`ReactionSync`, lib/reaction-sync.ts), so a burst of clicks ends in the
  state the reader last chose; a failure rolls the pill back with a toast.
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
  Reload.
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
  `toastActionFailure` says what happened — "Wizard was updated since this
  tab opened. Reload to keep going." with a Reload button for deploy skew
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
