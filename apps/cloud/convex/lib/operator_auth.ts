import { ConvexError } from "convex/values";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { authComponent } from "../auth.js";
import { requireRead, AUTH_UNAUTHORIZED } from "./auth_guard.js";
import type { AccountId, TokenId } from "../tokens.js";

/**
 * Dashboard operator auth (CLOUD-30b) — session OR bearer.
 *
 * The oversight dashboard's `api.dashboard.*` / `api.billing.getUsage` queries
 * historically authenticated with a read-scoped `swc_…` operator bearer (see
 * `lib/auth_guard.ts`). That path is unchanged — agents and the old fixtures
 * still work. This adds a SECOND accepted credential: a logged-in Better Auth
 * web session.
 *
 * Resolution order (mirrors how a human reaches the dashboard vs. how an
 * agent/script reaches the REST API):
 *
 *   1. If a non-blank `bearer` is supplied, fall straight through to the
 *      existing {@link requireRead} guard — IDENTICAL behavior, so every
 *      bearer-based test stays byte-green.
 *   2. Otherwise read the Better Auth identity via
 *      `authComponent.safeGetAuthUser(ctx)` and resolve the operator's
 *      `accounts` row by `authUserId` (the `by_authUserId` index). No session →
 *      401; a session whose account hasn't been provisioned yet → 401 with a
 *      `no_account` reason (the dashboard calls `ensureAccount` on first load to
 *      create it, then retries).
 *
 * The resolved shape matches {@link requireRead}'s `{ accountId, tokenId }` so
 * callers (`dashboard.ts`, `billing.ts`) need no other change: a session-scoped
 * caller simply has `tokenId === null` (it acted as the human, not a token).
 */
export interface OperatorAuthContext {
  accountId: AccountId;
  /** The acting token id, or null when the operator authed via a web session. */
  tokenId: TokenId | null;
}

/** The ctx shape this guard needs: the Better Auth GenericCtx + a db reader. */
type OperatorCtx = GenericCtx<DataModel> & Pick<QueryCtx, "db">;

/**
 * Resolve the operator's account from a read-scoped bearer OR the logged-in
 * Better Auth session. See the module note for the resolution order.
 *
 * @throws ConvexError<{ code: "UNAUTHORIZED", reason }> when neither credential
 *         resolves an account.
 */
export async function requireReadOperator(
  ctx: OperatorCtx,
  bearer: string | undefined | null,
): Promise<OperatorAuthContext> {
  // 1. Bearer path — unchanged. Keeps every existing test/fixture green.
  if (bearer && bearer.trim()) {
    const auth = await requireRead(ctx, bearer);
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  }

  // 2. Session path — the logged-in operator.
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: AUTH_UNAUTHORIZED,
      reason: "missing_token",
      message: "Not signed in",
    });
  }

  const account = await ctx.db
    .query("accounts")
    .withIndex("by_authUserId", (q) =>
      q.eq("authUserId", user._id as string),
    )
    .unique();

  if (!account) {
    throw new ConvexError({
      code: AUTH_UNAUTHORIZED,
      reason: "no_account",
      message: "No account provisioned for this operator yet",
    });
  }

  return { accountId: account._id as Id<"accounts">, tokenId: null };
}
