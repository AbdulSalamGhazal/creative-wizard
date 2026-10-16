# MCP, OAuth and AI diagnosis

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- **The MCP server is strictly READ-ONLY. Never add a mutating tool** — v1's
  whole design assumes it.
- Add a tool only via the registered-tool pattern in `lib/mcp/tools.ts`: a Zod
  input schema + `withBrand` + an existing `db/queries/*` fn. Never raw SQL.
- Tenancy is cookieless (`runWithTenant` + ALS) and validates the account is
  ALLOWED for the user; an access token resolves to its USER and scopes exactly
  as a personal token does.
- OAuth non-negotiables, all test-pinned: EXACT https `redirect_uri` matching
  with an error PAGE (never a redirect); PKCE S256; single-use 10-minute codes
  consumed by ONE atomic UPDATE; a replayed code revokes its family; refresh
  rotation with family revocation; opaque tokens stored as SHA-256; permissive
  CORS only on register/token/discovery, never authorize.
- **Diagnosis ASSEMBLES and INSTRUCTS — nothing in it calls an AI, holds a key,
  or writes.** Three layers stay separate: pure `lib/diagnosis.ts`, assembly in
  `db/queries/diagnosis.ts`, the MCP tool only wraps.
- The INTERVIEW rule, the ARTIFACT rule and the SELF-COMMITMENT sentence are
  the feature's spine; both sentences are string-pinned by named tests — do not
  delete either as redundant.
- The bundle must not lie by omission: NULLs preserved, a no-data day carries
  `records: 0`, caps are reported when they bite.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### AI campaign diagnosis

<!-- was CLAUDE.md L66–119 -->

- **AI CAMPAIGN DIAGNOSIS (2026-10) — the system ASSEMBLES and INSTRUCTS; it
  does not diagnose.** User decision ("option 2"): one read-only MCP tool,
  `diagnose_campaign`, returns a complete diagnostic bundle for one campaign
  plus the instructions for producing the report, and the user's OWN Claude
  does the thinking. **Nothing in this path calls an AI, holds an API key, or
  writes** — that was the point of choosing it, and adding any of those makes
  it a different feature. **It stays read-only like every other MCP tool;
  never add a mutating path for this.**
  - **Three layers, deliberately separate:** `lib/diagnosis.ts` is PURE (the
    bundle's shape, the serializer, the authored conventions + instructions),
    `db/queries/diagnosis.ts` assembles it from the queries the pages already
    use, and `lib/mcp/tools.ts` only wraps it in the house envelope. A future
    in-system page (option 3) renders the SAME bundle from the SAME serializer
    — which is why assembly never happens inside the MCP tool.
  - **THE INTERVIEW RULE is the feature's spine** (user decision), TUNED
    2026-10 from the first real transcript: the model asks for what the system
    does not have — **reach and frequency explicitly** — but **does NOT block
    the report on it**. Every section the bundle can answer ships; a
    conclusion that genuinely needs the missing data (any fatigue/saturation
    call) asks for it AT THAT POINT, marks that section "PENDING YOUR DATA",
    and is completed when the user answers. If they decline, every dependent
    conclusion is marked as resting on an assumption. A right diagnosis still
    outranks a fast one — the tuning changed the SCOPE of the wait, not the
    standard.
  - **The artifact rule is imperative, not a preference** — it did not fire
    when it read as one. The report MUST be created as an artifact (one
    self-contained HTML document), never as chat text or markdown tables; chat
    gets at most one sentence pointing to it; and data supplied later UPDATES
    the artifact (or issues a v2) rather than being answered in chat. **It
    binds EVERY version** — the first report with its PENDING sections and
    every reissue.
  - **SELF-COMMITMENT (2026-10) — the model restates the promise in its own
    words.** Rule 1 requires every chat message that asks the user for data to
    END with the verbatim sentence "When you answer, I'll update the report as
    an artifact — never as chat text." WHY: our instructions are DATA to the
    consuming Claude app, and the designed flow puts 2–3 turns between them and
    the report (tool call → question → answer → report) behind a ~26K-token
    bundle — in practice the report came back as chat text. A commitment the
    model wrote itself one turn earlier is what it actually re-reads. **Do not
    delete either sentence as redundant; both are string-pinned** by named
    tests in `lib/diagnosis.test.ts`.
  - **The bundle must not lie by omission:** NULLs are preserved (a metric the
    campaign's platform cannot report is `null`, never 0 — `nullUnavailable`),
    a no-data day carries `records: 0` so a gap can't read as a measured zero,
    caps (20 creatives / 26 weeks) are REPORTED when they bite, and the
    conventions block names what is absent (no reach/frequency, store
    attribution is platform-level only, no audience/placement/creative-asset
    data) so a confident model can't invent it.
  - **The report contract** (user-approved order): Verdict → Do this →
    Creative cards → Funnel vs benchmark → Budget context → Fine print,
    rendered as ONE self-contained HTML artifact, in English. The instructions
    and the section order are string-pinned by tests — a careless edit there
    degrades every diagnosis silently.


### MCP server

<!-- was CLAUDE.md L121–121 -->

- **MCP server (2026-07) — `/api/mcp/mcp`, bearer-authed, strictly READ-ONLY.** A remote MCP server (`mcp-handler`, route `app/api/mcp/[transport]/route.ts`) lets each user connect their own LLM to read-only analytics. Auth = a bearer token, and since 2026-10 it may be EITHER a personal access token (`api_tokens`; `lib/api-token.ts` — SHA-256 stored, raw `cwz_…` shown once, constant-time verify, revoke) OR an OAuth access token (next bullet); the route picks by prefix; `/api/mcp` is EXCLUDED from `middleware.ts` (its own bearer gate). Cookieless tenancy: `runWithTenant(accountId, userId, fn)` (`lib/tenant.ts` + `lib/tenant-context.ts` ALS) that `getActiveAccountId()`/`auth()` consult first — validates the account is ALLOWED for the user. **Add a tool ONLY via the registered-tool pattern in `lib/mcp/tools.ts`: a Zod input schema + `withBrand` + reuse a `db/queries/*` fn (never raw SQL), compact JSON out with a `{brand,range}` echo. NEVER add a mutating tool** (v1 is read-only; the whole design assumes it). Endpoint is `/api/mcp/mcp` (mcp-handler appends the transport segment to the `/api/mcp` basePath), not `/api/mcp`. Migration 0029 (additive `api_tokens`).

### OAuth 2.1

<!-- was CLAUDE.md L122–122 -->

- **OAuth 2.1 (2026-10, migration 0051) — connecting is a BROWSER SIGN-IN; keys still work.** The app is also the authorization server for its own MCP endpoint (`lib/oauth.ts` + `/api/oauth/*` + `/.well-known/*`): a 401 carries `WWW-Authenticate: …resource_metadata`, the client registers itself (RFC 7591), the user approves on `/oauth/consent`, and the code becomes an opaque access + refresh pair. **DUAL AUTH is the state**: personal `cwz_` tokens are unchanged and are the only path for `http://localhost` callbacks (mcp-remote, Claude Desktop), since registration is https-only; retiring them is a later decision. **No JWT and no new dependency** — opaque tokens stored as SHA-256, so Revoke is instant. Non-negotiables, all test-pinned: EXACT https redirect_uri matching with an error PAGE (never a redirect) when the client can't be verified; PKCE S256 required; single-use 10-minute codes consumed by ONE atomic `UPDATE … WHERE consumed_at IS NULL RETURNING`; a replayed code revokes the family it issued; refresh tokens rotate and reuse revokes the family; `family_id` is the grant lineage everything acts on; permissive CORS ONLY on register/token/discovery (never authorize — it reads the session cookie); `/api/oauth` + `/.well-known` leave the middleware gate, and the authorize route does its own session bounce to /signin. The issuer is ONE value (`canonicalOrigin`, `APP_ORIGIN` in prod). An access token resolves to its USER, and brand scoping follows that user exactly as a personal token does.
