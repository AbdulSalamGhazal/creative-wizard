import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiTokens } from "@/db/schema";
import { loadUserById, type SessionUser } from "@/lib/auth";

/**
 * Personal access tokens for the read-only MCP server (`/api/mcp`).
 *
 * A token acts as its owner: brand membership and read access apply exactly as
 * in the web app. The RAW secret is shown ONCE at creation and NEVER stored —
 * we keep only its SHA-256 (`token_hash`) and a short display `prefix`. Verify
 * hashes the presented secret and looks it up by that hash (a single indexed
 * hit), then confirms with a constant-time compare and rejects revoked tokens.
 */

/** Public prefix + secret both start with this so tokens are self-identifying. */
export const TOKEN_PREFIX = "cwz_";

/** SHA-256 hex of a raw token secret — what we store and look up by. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time equality of two hex strings. Different lengths → false without
 * leaking via early return. Used on the stored-vs-computed hash as defense in
 * depth on top of the indexed hash lookup.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** A freshly minted secret + the display prefix derived from it. */
export interface MintedToken {
  /** The full secret — `cwz_` + 40 base64url chars. Shown to the user ONCE. */
  raw: string;
  /** `cwz_` + first 8 secret chars — safe to persist/display. */
  prefix: string;
}

/** Mint a new random secret. Not persisted here — see `createApiToken`. */
export function mintTokenSecret(): MintedToken {
  // 30 random bytes → 40 base64url chars (URL-safe, no padding).
  const body = randomBytes(30).toString("base64url");
  const raw = `${TOKEN_PREFIX}${body}`;
  const prefix = `${TOKEN_PREFIX}${body.slice(0, 8)}`;
  return { raw, prefix };
}

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Create + persist a token for `userId`. Returns the RAW secret (to reveal once)
 * plus the stored row. The caller audits `token.create` — never the secret/hash.
 */
export async function createApiToken(
  userId: string,
  name: string,
): Promise<{ raw: string; row: ApiTokenRow }> {
  const { raw, prefix } = mintTokenSecret();
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name, tokenHash: hashToken(raw), prefix })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    });
  return { raw, row: row! };
}

/** A user's tokens, newest first (revoked ones excluded from the UI list). */
export async function listApiTokens(userId: string): Promise<ApiTokenRow[]> {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

/**
 * Revoke a token — scoped to `userId` so one user can't revoke another's. Sets
 * `revoked_at`; verify rejects any token with a non-null value. Returns the
 * token name (for the audit label) or null if it wasn't found/owned.
 */
export async function revokeApiToken(
  tokenId: string,
  userId: string,
): Promise<{ name: string } | null> {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ name: apiTokens.name });
  return row ?? null;
}

/** Stamp `last_used_at` at most once per minute (avoid a write on every call). */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Resolve a `Authorization: Bearer <secret>` value to the acting user, or null
 * for missing / malformed / unknown / revoked tokens. Constant-time hash
 * confirm; stamps `last_used_at` (throttled). This is the MCP auth gate.
 */
export async function verifyApiToken(
  bearer: string | null | undefined,
): Promise<{ user: SessionUser; tokenId: string } | null> {
  if (!bearer) return null;
  const raw = bearer.replace(/^Bearer\s+/i, "").trim();
  // Cheap shape gate before any DB work — a malformed value can't be ours.
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length < TOKEN_PREFIX.length + 20) {
    return null;
  }

  const hash = hashToken(raw);
  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      revokedAt: apiTokens.revokedAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  // Defense in depth: confirm the stored hash matches in constant time.
  if (!timingSafeEqualHex(row.tokenHash, hash)) return null;

  const user = await loadUserById(row.userId);
  if (!user) return null; // user deleted out from under the token

  const now = Date.now();
  if (
    !row.lastUsedAt ||
    now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, row.id));
  }

  return { user, tokenId: row.id };
}
