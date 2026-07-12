import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isScope, type Scope } from "../shared/src/scopes.js";

/**
 * Scoped API-token issuance, validation, and revocation (CLOUD-01, PRD §7).
 *
 * A scoped token is a bearer secret bound to an account with a set of
 * {@link Scope}s. The raw secret is shown exactly once at issue time and never
 * persisted — only its SHA-256 hash is stored (`tokens.tokenHash`). Validation
 * re-hashes the presented bearer and matches by hash.
 *
 * Per CLAUDE.md the decision logic (hashing, scope filtering, the
 * valid/revoked/expired verdict) is pure and lives in the small functions
 * below, so it is unit-testable with no Convex harness and no network. The
 * Convex `mutation`/`query` wrappers are thin shells around them.
 */

// ---------------------------------------------------------------------------
// Pure logic (no Convex, no IO) — directly unit-tested.
// ---------------------------------------------------------------------------

/** A 32-byte secret rendered as a prefixed base64url string for the user. */
export const TOKEN_PREFIX = "swc_";

/**
 * SHA-256 hex of a UTF-8 string, using Web Crypto (present in both the Convex
 * runtime and Node 18+ / the test environment). Pure relative to its input.
 */
export async function hashToken(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a fresh opaque token secret. `swc_` + 43 base64url chars (256 bits).
 * Pure relative to the injected randomness (defaults to Web Crypto).
 */
export function generateTokenSecret(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = randomBytes(32);
  // base64url without padding. `btoa` is available in both the Convex runtime
  // and the Node test environment, so we avoid Node's `Buffer` (whose types
  // aren't loaded — this workspace types against @cloudflare/workers-types).
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  const b64 = btoa(bin);
  const url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${TOKEN_PREFIX}${url}`;
}

/**
 * Normalize a requested scope list: keep only known scopes, de-dupe, preserve
 * canonical order. Unknown scopes are dropped (never granted). Pure.
 */
export function sanitizeScopes(requested: readonly string[]): Scope[] {
  const seen = new Set<Scope>();
  for (const s of requested) {
    if (isScope(s)) seen.add(s);
  }
  return [...seen];
}

/** The minimal token shape the verdict logic needs (a subset of the row). */
export interface TokenRecord {
  scopes: string[];
  revokedAt: number | null;
  expiresAt: number | null;
}

/** Why a token failed validation, or that it is valid. */
export type TokenVerdict =
  | { valid: true; scopes: Scope[] }
  | { valid: false; reason: "not_found" | "revoked" | "expired" };

/**
 * Decide whether a token record is currently usable, given the clock. Pure —
 * no DB lookup; the caller fetches the row (or passes null) and this renders
 * the verdict. A revoked token is reported `revoked` even past expiry, since
 * revocation is the more actionable signal.
 */
export function evaluateToken(
  record: TokenRecord | null | undefined,
  nowMs: number,
): TokenVerdict {
  if (!record) return { valid: false, reason: "not_found" };
  if (record.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (record.expiresAt !== null && record.expiresAt <= nowMs) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, scopes: sanitizeScopes(record.scopes) };
}

/** Does a verified token carry every scope in `required`? Pure. */
export function hasScopes(
  granted: readonly Scope[],
  required: readonly Scope[],
): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

// ---------------------------------------------------------------------------
// #201 — token lifetimes (PRD §7.1: short-lived access token + refresh token so
// revocation is a real kill switch, not advisory).
// ---------------------------------------------------------------------------

/** Access-token lifetime: 1 hour. The client refreshes on the 401 after expiry. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Refresh-token lifetime: 90 days. Rotated (single-use) on every exchange. */
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Convex wrappers — thin shells over the pure logic above.
// ---------------------------------------------------------------------------

/**
 * Mint a scoped token for an account. Returns the plaintext secret ONCE (the
 * caller must surface it to the user immediately) plus the new token id. Only
 * the hash is stored.
 *
 * SECURITY (audit #151/#152): this is an `internalMutation`, NOT a public one.
 * It mints a fully-scoped bearer (incl. `pages:write` / `domains:bind`) for an
 * arbitrary `accountId`, so exposing it as a public `mutation` was an account-
 * takeover hole — any caller with the deployment URL could mint a token for any
 * account. It is now reachable only server-side: from other Convex functions,
 * from operators via `npx convex run tokens:issueToken` (admin context), and
 * from tests via `internal.tokens.issueToken`. A session-gated, self-account-
 * only public wrapper for the dashboard's "create token" flow lands with the
 * dashboard trust-model work (#160); until then no public surface mints tokens.
 */
export const issueToken = internalMutation({
  args: {
    accountId: v.id("accounts"),
    scopes: v.array(v.string()),
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({
    tokenId: v.id("tokens"),
    secret: v.string(),
    scopes: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const minted = await mintAccessToken(ctx, {
      accountId: args.accountId,
      scopes: args.scopes,
      label: args.label ?? null,
      expiresAt: args.expiresAt ?? null,
    });
    return { tokenId: minted.tokenId, secret: minted.secret, scopes: minted.scopes };
  },
});

// ---------------------------------------------------------------------------
// #201 — ctx-level mint helpers. Shared by `issueToken`, the device-code
// exchange (`device.pollDeviceToken`), and the refresh-grant rotation below, so
// there is ONE insertion path for each credential kind (no duplicated hashing /
// insert logic, and no `runMutation`-from-a-mutation cross-call). They take a
// `MutationCtx` and do the insert directly; the plaintext secret is returned to
// the immediate caller and never persisted.
// ---------------------------------------------------------------------------

/** Args common to minting an access or refresh token. */
interface MintArgs {
  accountId: Id<"accounts">;
  scopes: readonly string[];
  label: string | null;
  /** Hard expiry (epoch ms), or null for no expiry (access tokens pass a TTL). */
  expiresAt: number | null;
}

/** Insert a short-lived access token into `tokens`. Returns the plaintext once. */
export async function mintAccessToken(
  ctx: MutationCtx,
  args: MintArgs,
): Promise<{ tokenId: Id<"tokens">; secret: string; scopes: Scope[] }> {
  const scopes = sanitizeScopes(args.scopes);
  const secret = generateTokenSecret();
  const tokenHash = await hashToken(secret);
  const now = Date.now();
  const tokenId = await ctx.db.insert("tokens", {
    accountId: args.accountId,
    tokenHash,
    scopes,
    label: args.label,
    createdAt: now,
    revokedAt: null,
    expiresAt: args.expiresAt,
  });
  return { tokenId, secret, scopes };
}

/** Insert a rotating refresh token into `refreshTokens`. Returns plaintext once. */
export async function mintRefreshToken(
  ctx: MutationCtx,
  args: MintArgs,
): Promise<{ tokenId: Id<"refreshTokens">; secret: string; scopes: Scope[] }> {
  const scopes = sanitizeScopes(args.scopes);
  const secret = generateTokenSecret();
  const tokenHash = await hashToken(secret);
  const now = Date.now();
  const tokenId = await ctx.db.insert("refreshTokens", {
    accountId: args.accountId,
    tokenHash,
    scopes,
    label: args.label,
    createdAt: now,
    revokedAt: null,
    expiresAt: args.expiresAt,
  });
  return { tokenId, secret, scopes };
}

/**
 * Issue an access+refresh PAIR for an account (the shape the device-code
 * exchange and the refresh-grant rotation both return). The access token gets a
 * short {@link ACCESS_TOKEN_TTL_MS} TTL; the refresh token a long
 * {@link REFRESH_TOKEN_TTL_MS} one. `nowMs` is injected so the two expiries key
 * off one clock read.
 */
export async function mintTokenPair(
  ctx: MutationCtx,
  args: { accountId: Id<"accounts">; scopes: readonly string[]; label: string | null },
  nowMs: number,
): Promise<{ accessToken: string; refreshToken: string; scopes: Scope[]; expiresInSeconds: number }> {
  const access = await mintAccessToken(ctx, {
    accountId: args.accountId,
    scopes: args.scopes,
    label: args.label,
    expiresAt: nowMs + ACCESS_TOKEN_TTL_MS,
  });
  const refresh = await mintRefreshToken(ctx, {
    accountId: args.accountId,
    scopes: args.scopes,
    label: args.label,
    expiresAt: nowMs + REFRESH_TOKEN_TTL_MS,
  });
  return {
    accessToken: access.secret,
    refreshToken: refresh.secret,
    scopes: access.scopes,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  };
}

/**
 * The RFC 6749 §6 `refresh_token` grant. Exchange a presented refresh secret for
 * a NEW access+refresh pair, ROTATING the refresh (single-use): the presented
 * refresh is revoked so a replay of a stolen refresh fails. Reuses the pure
 * {@link evaluateToken} verdict — a revoked/expired/unknown refresh returns
 * `invalid_grant` (RFC 6749 §5.2), never a new token. Called by the
 * `/oauth/token` handler for `grant_type=refresh_token`.
 */
export const rotateRefreshToken = internalMutation({
  args: { refreshToken: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      accessToken: v.string(),
      refreshToken: v.string(),
      scope: v.string(),
      expiresInSeconds: v.number(),
    }),
    v.object({ ok: v.literal(false), error: v.literal("invalid_grant") }),
  ),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.refreshToken);
    const row = await ctx.db
      .query("refreshTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    const now = Date.now();
    const verdict = evaluateToken(row, now);
    if (!verdict.valid) {
      return { ok: false as const, error: "invalid_grant" as const };
    }
    const found = row as Doc<"refreshTokens">;
    // Rotate: burn the presented refresh so it is single-use (a replayed refresh
    // hits `evaluateToken` → revoked → invalid_grant).
    await ctx.db.patch(found._id, { revokedAt: now });
    const pair = await mintTokenPair(
      ctx,
      { accountId: found.accountId, scopes: verdict.scopes, label: found.label },
      now,
    );
    return {
      ok: true as const,
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      scope: pair.scopes.join(" "),
      expiresInSeconds: pair.expiresInSeconds,
    };
  },
});

/**
 * Validate a presented bearer secret → `{ accountId, scopes }` when usable.
 * This is the function CLOUD-12's auth guard consumes. Returns a discriminated
 * result rather than throwing so the guard can map verdicts to HTTP statuses.
 */
export const validateToken = query({
  args: { secret: v.string() },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      accountId: v.id("accounts"),
      tokenId: v.id("tokens"),
      scopes: v.array(v.string()),
    }),
    v.object({
      valid: v.literal(false),
      reason: v.union(
        v.literal("not_found"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.secret);
    const row = await ctx.db
      .query("tokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    const verdict = evaluateToken(row, Date.now());
    if (!verdict.valid) {
      return { valid: false as const, reason: verdict.reason };
    }
    // `row` is non-null here (verdict valid implies it was found).
    const found = row as Doc<"tokens">;
    return {
      valid: true as const,
      accountId: found.accountId,
      tokenId: found._id,
      scopes: verdict.scopes,
    };
  },
});

/**
 * Revoke a token by flipping `revokedAt`. Idempotent: re-revoking keeps the
 * original revocation timestamp. Returns whether a change was made.
 *
 * SECURITY (epic #184): `internalMutation`, NOT public. It revokes ANY token by
 * id with no caller check — a public surface let anyone with the deployment URL
 * revoke any account's token. The dashboard revokes through the operator-gated,
 * account-scoped `dashboard.revokeToken`; server/admin use this via
 * `internal.tokens.revokeToken` / `npx convex run`.
 */
export const revokeToken = internalMutation({
  args: { tokenId: v.id("tokens") },
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.tokenId);
    if (!row) return { revoked: false };
    if (row.revokedAt !== null) return { revoked: true };
    await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
    return { revoked: true };
  },
});

/**
 * List an account's tokens (hash omitted). For server/admin use.
 *
 * SECURITY (epic #184): `internalQuery`, NOT public — a public query let anyone
 * enumerate any account's token metadata by id. The dashboard lists through the
 * operator-gated, account-scoped `dashboard.listTokens`.
 */
export const listTokensForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tokens")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    return rows.map((r: Doc<"tokens">) => ({
      tokenId: r._id,
      scopes: r.scopes,
      label: r.label,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
      expiresAt: r.expiresAt,
    }));
  },
});

// Re-export the id type alias so CLOUD-12 can name token ids without reaching
// into _generated.
export type TokenId = Id<"tokens">;
export type AccountId = Id<"accounts">;
