import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server.js";
import type { AccountId, TokenId, TokenVerdict } from "../tokens.js";
import { evaluateToken, hasScopes, hashToken } from "../tokens.js";
import {
  SCOPE_DOMAINS_BIND,
  SCOPE_MODERATION_ADMIN,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
  type Scope,
} from "../../shared/src/scopes.js";

/**
 * Server-side bearer-token auth guard (CLOUD-12, PRD §7.2).
 *
 * Every Wave-3 mutation/query that touches account-scoped data routes through
 * {@link requireAuth} (or one of the `requireRead`/`requireWrite`/
 * `requireDomainsBind` wrappers). The guard:
 *
 *   1. rejects a missing/blank bearer  → 401 (`UNAUTHORIZED`, `missing_token`)
 *   2. re-hashes the presented secret and looks the row up by hash
 *   3. renders the validity verdict via the PURE {@link evaluateToken}
 *      (not-found / revoked / expired) → 401
 *   4. enforces `requiredScopes` via the PURE {@link hasScopes} → 403 when any
 *      required scope is absent (e.g. a default token lacks `domains:bind`)
 *   5. on success resolves `{ accountId, tokenId, scopes }`.
 *
 * The validity + scope decision is factored into the pure {@link decideAuth},
 * which is unit-tested with no Convex harness. `requireAuth` is the thin
 * ctx-bound shell that does the hash + DB lookup and maps the decision to a
 * typed {@link ConvexError}.
 *
 * Error convention mirrors nyxe-mail: throw `ConvexError({ code, message })`
 * with a machine-readable `code`, so the HTTP edge (CLOUD-21+) can translate
 * `UNAUTHORIZED` → 401 and `FORBIDDEN` → 403 without string-matching.
 */

// ---------------------------------------------------------------------------
// Error shape — local to lib/ (shared/ is owned elsewhere; do not edit it).
// ---------------------------------------------------------------------------

/** 401-equivalent: no usable identity (missing / invalid / revoked / expired). */
export const AUTH_UNAUTHORIZED = "UNAUTHORIZED" as const;
/** 403-equivalent: authenticated, but the token lacks a required scope. */
export const AUTH_FORBIDDEN = "FORBIDDEN" as const;

export type AuthErrorCode = typeof AUTH_UNAUTHORIZED | typeof AUTH_FORBIDDEN;

/** Why authentication failed (401 family). */
export type AuthFailureReason =
  | "missing_token"
  | "not_found"
  | "revoked"
  | "expired";

/**
 * The structured payload carried by a thrown `ConvexError`. `code` selects the
 * HTTP family; `reason` is the actionable detail; `missing` enumerates the
 * absent scopes on a 403.
 */
export type AuthErrorPayload =
  | { code: typeof AUTH_UNAUTHORIZED; reason: AuthFailureReason; message: string }
  | {
      code: typeof AUTH_FORBIDDEN;
      reason: "insufficient_scope";
      missing: Scope[];
      message: string;
    };

/** The resolved identity handed back to a guarded function on success. */
export interface AuthContext {
  accountId: AccountId;
  tokenId: TokenId;
  scopes: Scope[];
}

// ---------------------------------------------------------------------------
// Pure decision — no Convex, no IO. Directly unit-tested.
// ---------------------------------------------------------------------------

/** The pure authorization decision: a token verdict + the scopes it needs. */
export type AuthDecision =
  | { ok: true; scopes: Scope[] }
  | { ok: false; code: typeof AUTH_UNAUTHORIZED; reason: AuthFailureReason }
  | {
      ok: false;
      code: typeof AUTH_FORBIDDEN;
      reason: "insufficient_scope";
      missing: Scope[];
    };

/**
 * Turn a {@link TokenVerdict} (from {@link evaluateToken}) plus the required
 * scopes into an authorization decision. Pure — the caller does the IO.
 *
 * - invalid verdict → 401 with the verdict's reason
 * - valid but missing a required scope → 403 listing the missing scopes
 * - valid with every required scope → ok, echoing the granted scopes
 */
export function decideAuth(
  verdict: TokenVerdict,
  requiredScopes: readonly Scope[],
): AuthDecision {
  if (!verdict.valid) {
    return { ok: false, code: AUTH_UNAUTHORIZED, reason: verdict.reason };
  }
  if (!hasScopes(verdict.scopes, requiredScopes)) {
    const granted = new Set(verdict.scopes);
    const missing = requiredScopes.filter((s) => !granted.has(s));
    return {
      ok: false,
      code: AUTH_FORBIDDEN,
      reason: "insufficient_scope",
      missing,
    };
  }
  return { ok: true, scopes: verdict.scopes };
}

// ---------------------------------------------------------------------------
// ctx-bound guard — thin shell over decideAuth + the pure token logic.
// ---------------------------------------------------------------------------

/** Human-readable message for a 401 reason. */
function unauthorizedMessage(reason: AuthFailureReason): string {
  switch (reason) {
    case "missing_token":
      return "Missing bearer token";
    case "not_found":
      return "Invalid bearer token";
    case "revoked":
      return "Token has been revoked";
    case "expired":
      return "Token has expired";
  }
}

/** Build (and never accidentally leak the secret in) the typed auth error. */
function authError(payload: AuthErrorPayload): ConvexError<AuthErrorPayload> {
  return new ConvexError(payload);
}

/**
 * The slice of `QueryCtx` this guard needs: a database reader. Accepting the
 * structural minimum (rather than the full ctx) lets both queries and
 * mutations pass their ctx and keeps the guard unit-testable with a fake.
 */
export type GuardCtx = Pick<QueryCtx, "db">;

/**
 * Validate a presented bearer token and enforce `requiredScopes`.
 *
 * @param ctx           a query/mutation ctx (only `ctx.db` is read)
 * @param bearerToken   the raw `swc_…` secret, or `undefined`/blank if absent
 * @param requiredScopes scopes the caller must hold (empty ⇒ auth only)
 * @returns the resolved `{ accountId, tokenId, scopes }`
 * @throws  {@link ConvexError}<{@link AuthErrorPayload}> — `UNAUTHORIZED` (401)
 *          for missing/invalid/revoked/expired, `FORBIDDEN` (403) for scope.
 *
 * Offline-codegen note: this re-hashes + queries the `tokens` table directly
 * via `ctx.db` rather than calling `api.tokens.validateToken`. A function
 * reference (`api.*`) requires fresh `_generated`, which cannot be produced
 * here without `CONVEX_DEPLOYMENT`. Reusing the PURE `evaluateToken`/
 * `hasScopes` from `../tokens` gives identical verdict logic while typechecking
 * offline. The lookup mirrors `validateToken`'s `by_tokenHash` index exactly.
 */
export async function requireAuth(
  ctx: GuardCtx,
  bearerToken: string | undefined | null,
  requiredScopes: readonly Scope[],
): Promise<AuthContext> {
  const secret = bearerToken?.trim();
  if (!secret) {
    throw authError({
      code: AUTH_UNAUTHORIZED,
      reason: "missing_token",
      message: unauthorizedMessage("missing_token"),
    });
  }

  const tokenHash = await hashToken(secret);
  const row = await ctx.db
    .query("tokens")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  const verdict: TokenVerdict = evaluateToken(row, Date.now());
  const decision = decideAuth(verdict, requiredScopes);

  if (!decision.ok) {
    if (decision.code === AUTH_FORBIDDEN) {
      throw authError({
        code: AUTH_FORBIDDEN,
        reason: "insufficient_scope",
        missing: decision.missing,
        message: `Token lacks required scope(s): ${decision.missing.join(", ")}`,
      });
    }
    throw authError({
      code: AUTH_UNAUTHORIZED,
      reason: decision.reason,
      message: unauthorizedMessage(decision.reason),
    });
  }

  // `decision.ok` implies the row was found and valid.
  const found = row as NonNullable<typeof row>;
  return {
    accountId: found.accountId,
    tokenId: found._id,
    scopes: decision.scopes,
  };
}

// ---------------------------------------------------------------------------
// Ergonomic wrappers — the three scope tiers Wave-3 verbs reach for.
// ---------------------------------------------------------------------------

/** Require `pages:read` (find / list / get). */
export function requireRead(
  ctx: GuardCtx,
  bearerToken: string | undefined | null,
): Promise<AuthContext> {
  return requireAuth(ctx, bearerToken, [SCOPE_PAGES_READ]);
}

/** Require `pages:write` (publish / update / delete / visibility). */
export function requireWrite(
  ctx: GuardCtx,
  bearerToken: string | undefined | null,
): Promise<AuthContext> {
  return requireAuth(ctx, bearerToken, [SCOPE_PAGES_WRITE]);
}

/**
 * Require `domains:bind` — the privileged, human-gated scope absent from the
 * default device-flow token (PRD §7.2).
 */
export function requireDomainsBind(
  ctx: GuardCtx,
  bearerToken: string | undefined | null,
): Promise<AuthContext> {
  return requireAuth(ctx, bearerToken, [SCOPE_DOMAINS_BIND]);
}

/** The resolved identity for a moderation verb, tagging operator authority. */
export interface ModerationAuthContext extends AuthContext {
  /**
   * True when the token carries `moderation:admin` — it may act CROSS-account
   * (the operator kill path). False for an ordinary `pages:write` token, which
   * remains self-account-only (it may quarantine its OWN pages).
   */
  isModerator: boolean;
}

/**
 * Auth for the moderation verbs (audit #151 CRITICAL #2). Accepts EITHER an
 * operator token (`moderation:admin` → cross-account authority) OR an ordinary
 * `pages:write` token (self-account only). The caller enforces the account
 * scoping using {@link ModerationAuthContext.isModerator}: a moderator may act on
 * any page; a writer only on pages in its own account.
 *
 * A token with neither scope is rejected 403 (insufficient_scope) listing
 * `pages:write` — the minimum an account needs to moderate its own content.
 */
export async function requireModeration(
  ctx: GuardCtx,
  bearerToken: string | undefined | null,
): Promise<ModerationAuthContext> {
  // Authenticate first (valid/unrevoked/unexpired), then apply the OR-of-scopes.
  const auth = await requireAuth(ctx, bearerToken, []);
  const isModerator = auth.scopes.includes(SCOPE_MODERATION_ADMIN);
  const canWrite = auth.scopes.includes(SCOPE_PAGES_WRITE);
  if (!isModerator && !canWrite) {
    throw authError({
      code: AUTH_FORBIDDEN,
      reason: "insufficient_scope",
      missing: [SCOPE_PAGES_WRITE as Scope],
      message: `Token lacks required scope(s): ${SCOPE_PAGES_WRITE}`,
    });
  }
  return { ...auth, isModerator };
}
