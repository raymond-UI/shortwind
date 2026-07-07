import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { FREE_PLAN, type PlanId } from "./billing_plans.js";

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

const defaultResolver: PlanResolver = {
  resolve: async () => FREE_PLAN,
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
