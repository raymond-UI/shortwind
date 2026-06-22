/**
 * CLOUD-33 — per-account publish rate limiting (PRD §8.4).
 *
 * Publish is a high-volume abuse surface (phishing / malware pages are published
 * at scale), so each account is rate-limited at publish time. The limit is
 * checked at the very start of the publish pipeline (after auth) and a trip
 * rejects the request with a `retryAfter` (ms) the caller can back off on.
 *
 * Two-layer design (mandated by the offline constraint):
 *
 *   1. The REAL limiter is `@convex-dev/rate-limiter` (registered as a component
 *      in convex.config.ts, same as nyxe-mail / Togethr). Its `.limit(ctx, name,
 *      { key, throws:false })` returns `{ ok, retryAfter }`. This is the
 *      production path at deploy.
 *   2. The component runs a child-component mutation, which the offline
 *      `convex-test` runtime cannot execute. So the publish hook talks to an
 *      injectable {@link PublishLimiter} interface; the DEFAULT implementation
 *      delegates to the real component, and tests inject a deterministic
 *      in-memory token-bucket limiter. The component is STILL registered so the
 *      deploy path is wired; only the test seam differs.
 *
 * {@link checkPublishLimit} is the single entry point the publish hook calls. It
 * returns `{ ok, retryAfter }` — `ok:false` ⇒ reject the publish with the
 * `retryAfter`.
 */

import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api.js";

// ---------------------------------------------------------------------------
// Limit configuration (sensible launch values; tuned at deploy — CLOUD-30b).
// ---------------------------------------------------------------------------

/** The named publish limit key in the component config. */
export const PUBLISH_LIMIT_NAME = "publish" as const;

/** The named public abuse-report intake limit key (audit #158). */
export const ABUSE_LIMIT_NAME = "abuseReport" as const;

/**
 * Per-client (IP) abuse-report limit: the public `/v1/abuse` intake is an
 * unauthenticated write surface, so an unbounded caller could flood the audit log
 * + moderation table. A token bucket of 20/min sustained with a burst of 10 lets a
 * genuine reporter file several reports while capping a flooder.
 */
export const ABUSE_RATE = 20;
export const ABUSE_BURST = 10;

/**
 * Per-account publish limit: a token bucket of 10/min sustained with a burst of
 * 5. A burst lets an agent ship a small batch of pages quickly; the sustained
 * rate caps a runaway / abusive account. Mirrors the nyxe-mail / Togethr token
 * bucket shape.
 */
export const PUBLISH_RATE = 10;
export const PUBLISH_BURST = 5;

/**
 * The real component-backed limiter. Registered via convex.config.ts → available
 * as `components.rateLimiter`. Active at deploy; in offline tests the publish
 * hook injects an in-memory limiter instead (see {@link PublishLimiter}).
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  [PUBLISH_LIMIT_NAME]: {
    kind: "token bucket",
    rate: PUBLISH_RATE,
    period: MINUTE,
    capacity: PUBLISH_BURST,
  },
  [ABUSE_LIMIT_NAME]: {
    kind: "token bucket",
    rate: ABUSE_RATE,
    period: MINUTE,
    capacity: ABUSE_BURST,
  },
});

// ---------------------------------------------------------------------------
// Injectable limiter seam (offline test path).
// ---------------------------------------------------------------------------

/** The result of a limit check: `ok:false` ⇒ reject with `retryAfter` ms. */
export interface PublishLimitResult {
  ok: boolean;
  /** Milliseconds until a retry could succeed (present when known). */
  retryAfter?: number;
}

/**
 * The minimal limiter surface the publish hook depends on. The production
 * implementation delegates to the `@convex-dev/rate-limiter` component; the test
 * implementation is an in-memory token bucket. Keeping the dependency abstract is
 * what lets the publish path run under offline `convex-test` (which cannot
 * execute the component's child mutations).
 */
export interface PublishLimiter {
  /** Consume one publish token for `accountId`; report whether it was allowed. */
  check(
    ctx: RateLimitRunCtx,
    accountId: string,
  ): Promise<PublishLimitResult>;
}

/** The slice of ctx the real component limiter needs (`runMutation`-capable). */
export type RateLimitRunCtx = {
  runMutation: (ref: any, args: any) => Promise<any>;
  runQuery?: (ref: any, args: any) => Promise<any>;
};

/**
 * The production limiter: delegates to the registered component. `throws:false`
 * so we surface `{ ok, retryAfter }` and let the publish hook decide the
 * rejection shape (a `ConvexError` with the retryAfter), rather than the
 * component's own thrown error.
 */
export const componentPublishLimiter: PublishLimiter = {
  check: async (ctx, accountId) => {
    try {
      const res = await rateLimiter.limit(ctx as never, PUBLISH_LIMIT_NAME, {
        key: accountId,
        throws: false,
      });
      return { ok: res.ok, retryAfter: res.retryAfter };
    } catch (err) {
      // The component runs a child-component mutation, which the OFFLINE
      // `convex-test` runtime cannot execute (it throws the SPECIFIC "component
      // is not registered" error). ONLY that exact offline condition fails OPEN
      // so the publish path stays exercisable without the component. At deploy
      // the component IS registered, so that error never occurs.
      //
      // SECURITY (audit #158): any OTHER limiter error (transient/network/component
      // fault in prod) must FAIL CLOSED — a rate limiter that fails open lets an
      // abuser bypass the publish cap. A short retryAfter lets legit clients retry.
      if (isOfflineComponentMissing(err)) return { ok: true };
      return { ok: false, retryAfter: 1000 };
    }
  },
};

/**
 * True ONLY for the exact offline `convex-test` "component not registered"
 * failure. Kept narrow (audit #158) so a prod/transient error can never be
 * mistaken for it and fail open — the prior broad `component .* is not` pattern
 * could have matched unrelated prod errors.
 */
function isOfflineComponentMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /is not registered|not registered as a component/i.test(msg);
}

/**
 * A deterministic in-memory token-bucket limiter for offline tests (the component
 * cannot run under `convex-test`). Same token-bucket semantics as the configured
 * component limit: `capacity` burst, refilled at `rate` per `periodMs`. Per-key
 * (accountId) state held in a Map. NOT for production — purely the test seam.
 */
export function inMemoryPublishLimiter(
  opts: {
    rate?: number;
    capacity?: number;
    periodMs?: number;
    now?: () => number;
  } = {},
): PublishLimiter {
  const rate = opts.rate ?? PUBLISH_RATE;
  const capacity = opts.capacity ?? PUBLISH_BURST;
  const periodMs = opts.periodMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  const refillPerMs = rate / periodMs;
  const buckets = new Map<string, { tokens: number; updated: number }>();

  return {
    check: async (_ctx, accountId) => {
      const t = now();
      const b = buckets.get(accountId) ?? { tokens: capacity, updated: t };
      // Refill since last check, clamped to capacity.
      const refilled = Math.min(capacity, b.tokens + (t - b.updated) * refillPerMs);
      if (refilled >= 1) {
        buckets.set(accountId, { tokens: refilled - 1, updated: t });
        return { ok: true };
      }
      // Out of tokens: time until one token refills.
      const retryAfter = Math.ceil((1 - refilled) / refillPerMs);
      buckets.set(accountId, { tokens: refilled, updated: t });
      return { ok: false, retryAfter };
    },
  };
}

// ---------------------------------------------------------------------------
// The publish-hook entry point.
// ---------------------------------------------------------------------------

/**
 * The active limiter. Defaults to the real component-backed limiter; the publish
 * tests override it with an in-memory limiter via {@link __setPublishLimiter}
 * (the component's child mutations don't run under offline `convex-test`).
 */
let publishLimiter: PublishLimiter = componentPublishLimiter;

/** Test-only: inject an in-memory limiter so the publish hook runs offline. */
export function __setPublishLimiter(limiter: PublishLimiter): void {
  publishLimiter = limiter;
}

/** Test-only: restore the production component-backed limiter. */
export function __resetPublishLimiter(): void {
  publishLimiter = componentPublishLimiter;
}

/**
 * Consume one publish token for `accountId`. Returns `{ ok, retryAfter }`:
 * `ok:false` ⇒ the account tripped its publish limit and the publish must be
 * rejected with the `retryAfter` (ms). This is the single seam the pages.ts
 * publish hook calls.
 */
export function checkPublishLimit(
  ctx: RateLimitRunCtx,
  accountId: string,
): Promise<PublishLimitResult> {
  return publishLimiter.check(ctx, accountId);
}

/**
 * Per-client (IP) throttle for the public abuse-report intake (audit #158).
 * Called from the `/v1/abuse` httpAction (an action — runMutation-capable). Same
 * fail posture as the publish limiter: the OFFLINE component-missing error fails
 * OPEN (so a future offline test of the intake stays exercisable), any other
 * error FAILS CLOSED. `key` is the client IP (or "unknown" when absent).
 */
export async function checkAbuseLimit(
  ctx: RateLimitRunCtx,
  key: string,
): Promise<PublishLimitResult> {
  try {
    const res = await rateLimiter.limit(ctx as never, ABUSE_LIMIT_NAME, {
      key,
      throws: false,
    });
    return { ok: res.ok, retryAfter: res.retryAfter };
  } catch (err) {
    if (isOfflineComponentMissing(err)) return { ok: true };
    return { ok: false, retryAfter: 1000 };
  }
}
