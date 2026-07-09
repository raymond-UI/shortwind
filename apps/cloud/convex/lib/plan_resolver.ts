import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { type PlanId } from "./billing_plans.js";
import { makeStripePlanResolver } from "../billingStripe/plan.js";

/**
 * Plan-resolution seam (mirrors `domains.ts`'s `__setCloudflareSaaSClient` and
 * `rate_limit.ts`'s in-memory limiter).
 *
 * Resolving an account's plan requires the Stripe billing component
 * (`billingStripe/lib.ts` → `activeSubscription`), which is only available on a
 * real deployment — under `convex-test` the component's child queries don't run.
 * So the enforcement paths (`domains.ts`) depend on THIS seam, not on the Stripe
 * module directly: the file stays free of any billing-component import, and
 * offline tests inject a resolver.
 *
 * **Closed-by-default:** the default resolver returns `free`, which the
 * entitlement policy (`billing_limits.ts`) treats as "no custom domains." So an
 * un-provisioned deployment blocks custom-domain binds rather than silently
 * granting them — the same safe-by-default posture as the Cloudflare client
 * throwing `NOT_CONFIGURED`. Deploy wires the real Stripe-backed resolver via
 * `__setPlanResolver` (see `billingStripe/plan.ts`).
 */
export interface PlanResolver {
  resolve(ctx: QueryCtx, accountId: Id<"accounts">): Promise<PlanId>;
}

// Production default: the REAL Stripe-backed resolver (an account with no active
// subscription resolves to `free`). Imported STATICALLY — Convex bundles
// functions and does NOT support dynamic `import()` in the function runtime, so a
// lazy import throws and would silently fall back to `free` (a Pro account would
// be wrongly blocked). Offline tests inject a resolver via `__setPlanResolver`,
// so the default's `resolve` is never called under convex-test; only the module
// (and `billingStripe`'s already-registered `components.stripe`) loads, which is
// safe. Errors from the resolver (e.g. an unknown price) propagate — never
// masked into `free`.
const stripeResolver = makeStripePlanResolver();
const defaultResolver: PlanResolver = {
  resolve: (ctx, accountId) => stripeResolver.resolve(ctx, accountId),
};

let resolver: PlanResolver = defaultResolver;

/** Test/deploy seam: inject the plan resolver (real Stripe-backed at deploy). */
export function __setPlanResolver(next: PlanResolver): void {
  resolver = next;
}

/** Restore the closed-by-default (`free`) resolver. */
export function __resetPlanResolver(): void {
  resolver = defaultResolver;
}

/** Resolve the account's current plan through the active resolver. */
export function resolvePlan(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
): Promise<PlanId> {
  return resolver.resolve(ctx, accountId);
}
