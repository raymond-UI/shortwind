import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { FREE_PLAN, type PlanId } from "../lib/billing_plans.js";
import type { PlanResolver } from "../lib/plan_resolver.js";
import { activeSubscription } from "./lib.js";
import { subscriptionToPlan } from "./plans.js";

/**
 * The real, Stripe-backed plan resolver — the deploy-time implementation of the
 * `plan_resolver.ts` seam. Kept in the `billingStripe` feature (not in `lib/`)
 * so the Stripe component dependency stays inside the feature: `domains.ts`
 * imports only the seam, never this.
 *
 * Deploy wiring (alongside `__setCloudflareSaaSClient`): call
 * `__setPlanResolver(makeStripePlanResolver())` once at startup so the
 * custom-domain gate resolves live plans instead of the closed-by-default
 * `free`.
 *
 * An account with no active subscription resolves to `free` (the implicit
 * default). `subscriptionToPlan` throws `BILLING_UNKNOWN_PRICE` if an active sub
 * carries a price absent from the catalog — that loud failure is intentional
 * (see `plans.ts`), so it is NOT swallowed here.
 */
export function makeStripePlanResolver(): PlanResolver {
  return {
    async resolve(ctx: QueryCtx, accountId: Id<"accounts">): Promise<PlanId> {
      const sub = await activeSubscription(ctx, {
        type: "account",
        accountId,
      });
      return sub ? subscriptionToPlan(sub) : FREE_PLAN;
    },
  };
}
