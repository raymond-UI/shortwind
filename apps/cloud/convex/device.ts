import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import { hashToken, mintTokenPair } from "./tokens";
import {
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
  pollVerdict,
} from "./lib/device_grant";

/**
 * Native RFC 8628 device-authorization grant — the Convex IO shell.
 *
 * The default @convex-dev/better-auth component cannot store device codes (its
 * adapter schema has no `deviceCode` model), so the CLI `login` flow is served
 * here instead, against the `deviceCodes` table. The wire layer lives in
 * `convex/http.ts` (`POST /oauth/device/code`, `POST /oauth/token`); the pure
 * decision logic in `convex/lib/device_grant.ts`. Approval mints a scoped `swc_`
 * token via `tokens.issueToken`, so the rest of the system is unchanged.
 */

/** Device code lifetime (RFC 8628 §3.2 `expires_in`). */
const DEVICE_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** Minimum seconds between token polls (RFC 8628 §3.5 `interval`). */
const POLL_INTERVAL_MS = 5_000; // 5 seconds

/**
 * Create a pending device code. Called from the `/oauth/device/code` HTTP action
 * (public — any client_id is accepted; the gate is the human approval). Returns
 * the RAW device_code + user_code exactly once; only the device_code HASH is
 * stored.
 */
export const requestDeviceCode = internalMutation({
  args: { clientId: v.string(), scope: v.string() },
  returns: v.object({
    deviceCode: v.string(),
    userCode: v.string(),
    expiresInSeconds: v.number(),
    intervalSeconds: v.number(),
  }),
  handler: async (ctx, args) => {
    const deviceCode = generateDeviceCode();
    const deviceCodeHash = await hashToken(deviceCode);

    // Pick a user_code that is not currently live (collisions are astronomically
    // unlikely, but a live duplicate would make the dashboard claim ambiguous).
    let userCode = generateUserCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await ctx.db
        .query("deviceCodes")
        .withIndex("by_userCode", (q) => q.eq("userCode", userCode))
        .first();
      if (!clash) break;
      userCode = generateUserCode();
    }

    const now = Date.now();
    await ctx.db.insert("deviceCodes", {
      deviceCodeHash,
      userCode,
      clientId: args.clientId,
      scope: args.scope,
      status: "pending",
      accountId: null,
      createdAt: now,
      expiresAt: now + DEVICE_CODE_TTL_MS,
      lastPolledAt: null,
      pollingInterval: POLL_INTERVAL_MS,
    });

    return {
      deviceCode,
      userCode,
      expiresInSeconds: Math.floor(DEVICE_CODE_TTL_MS / 1000),
      intervalSeconds: Math.floor(POLL_INTERVAL_MS / 1000),
    };
  },
});

/**
 * The poll result — annotated explicitly so the handler's inferred return type
 * is a concrete union (not the generated `any` a cross-module reference would
 * otherwise widen it to). On approval it carries the minted access+refresh pair
 * and the access TTL (#201).
 */
type PollResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      scope: string;
      expiresInSeconds: number;
    }
  | {
      ok: false;
      error:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token"
        | "invalid_grant";
    };

/**
 * Poll the grant with a device_code. Called from the `/oauth/token` HTTP action.
 * Returns either a minted token (on approval — single-use, the row flips to
 * `consumed`) or an RFC 8628 §3.5 error code the wire layer maps to a 400 body.
 */
export const pollDeviceToken = internalMutation({
  args: { deviceCode: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      accessToken: v.string(),
      refreshToken: v.string(),
      scope: v.string(),
      expiresInSeconds: v.number(),
    }),
    v.object({
      ok: v.literal(false),
      error: v.union(
        v.literal("authorization_pending"),
        v.literal("slow_down"),
        v.literal("access_denied"),
        v.literal("expired_token"),
        v.literal("invalid_grant"),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<PollResult> => {
    const deviceCodeHash = await hashToken(args.deviceCode);
    const row = await ctx.db
      .query("deviceCodes")
      .withIndex("by_deviceCodeHash", (q) =>
        q.eq("deviceCodeHash", deviceCodeHash),
      )
      .first();
    if (!row) return { ok: false as const, error: "invalid_grant" as const };

    const now = Date.now();
    const verdict = pollVerdict(
      {
        status: row.status,
        expiresAt: row.expiresAt,
        lastPolledAt: row.lastPolledAt,
        pollingInterval: row.pollingInterval,
        accountId: row.accountId as string | null,
      },
      now,
    );

    switch (verdict.state) {
      case "expired":
        return { ok: false as const, error: "expired_token" as const };
      case "denied":
        return { ok: false as const, error: "access_denied" as const };
      case "slow_down":
        return { ok: false as const, error: "slow_down" as const };
      case "consumed":
        return { ok: false as const, error: "invalid_grant" as const };
      case "pending":
        await ctx.db.patch(row._id, { lastPolledAt: now });
        return {
          ok: false as const,
          error: "authorization_pending" as const,
        };
      case "approved": {
        // Mint the scoped access+refresh PAIR the rest of the system understands
        // (short-lived access token so revocation bites + a rotating refresh so
        // the CLI can renew without re-running the device flow, #201), then burn
        // the code so a replayed device_code can never re-mint (single-use).
        const pair = await mintTokenPair(
          ctx,
          {
            accountId: row.accountId!,
            scopes: row.scope.split(/\s+/).filter(Boolean),
            label: `cli:${row.clientId}`,
          },
          now,
        );
        await ctx.db.patch(row._id, { status: "consumed", lastPolledAt: now });
        return {
          ok: true as const,
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          scope: pair.scopes.join(" "),
          expiresInSeconds: pair.expiresInSeconds,
        };
      }
    }
  },
});

/**
 * Look up a pending device code by the human-entered user_code (for the
 * dashboard approval page). Returns only what the page must display — never the
 * device_code or any secret.
 */
export const lookupUserCode = query({
  args: { userCode: v.string() },
  returns: v.union(
    v.object({
      found: v.literal(true),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
        v.literal("consumed"),
      ),
      scope: v.string(),
      clientId: v.string(),
      expired: v.boolean(),
    }),
    v.object({ found: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeUserCode(args.userCode);
    if (!normalized) return { found: false as const };
    const row = await ctx.db
      .query("deviceCodes")
      .withIndex("by_userCode", (q) => q.eq("userCode", normalized))
      .first();
    if (!row) return { found: false as const };
    return {
      found: true as const,
      status: row.status,
      scope: row.scope,
      clientId: row.clientId,
      expired: Date.now() >= row.expiresAt,
    };
  },
});

/** Resolve the signed-in dashboard human to their account, or throw 401/403. */
async function requireAccount(ctx: MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Sign in to approve a device.",
    });
  }
  const account = await ctx.db
    .query("accounts")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", user._id as string))
    .first();
  if (!account) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "No account for this user.",
    });
  }
  return account;
}

/**
 * Approve a device code (dashboard, session-gated). Flips the row to `approved`
 * and stamps the approving human's account, so the next CLI poll mints a token
 * scoped to THIS account.
 */
export const approveDeviceCode = mutation({
  args: { userCode: v.string() },
  returns: v.object({ ok: v.boolean(), scope: v.string() }),
  handler: async (ctx, args) => {
    const account = await requireAccount(ctx);
    const normalized = normalizeUserCode(args.userCode);
    const row = await ctx.db
      .query("deviceCodes")
      .withIndex("by_userCode", (q) => q.eq("userCode", normalized))
      .first();
    if (!row) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Unknown code." });
    }
    if (Date.now() >= row.expiresAt) {
      throw new ConvexError({ code: "EXPIRED", message: "Code expired." });
    }
    if (row.status !== "pending") {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Code already ${row.status}.`,
      });
    }
    await ctx.db.patch(row._id, {
      status: "approved",
      accountId: account._id,
    });
    return { ok: true, scope: row.scope };
  },
});

/** Deny a device code (dashboard, session-gated). */
export const denyDeviceCode = mutation({
  args: { userCode: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAccount(ctx);
    const normalized = normalizeUserCode(args.userCode);
    const row = await ctx.db
      .query("deviceCodes")
      .withIndex("by_userCode", (q) => q.eq("userCode", normalized))
      .first();
    if (!row) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Unknown code." });
    }
    if (row.status === "pending") {
      await ctx.db.patch(row._id, { status: "denied" });
    }
    return { ok: true };
  },
});

/**
 * Hourly sweep: hard-delete elapsed device codes (no audit/preservation value —
 * a device code is a transient auth artifact, unlike a page tombstone).
 */
export const sweepExpiredDeviceCodes = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("deviceCodes")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
      .take(500);
    for (const row of due) await ctx.db.delete(row._id);
    return { deleted: due.length };
  },
});
