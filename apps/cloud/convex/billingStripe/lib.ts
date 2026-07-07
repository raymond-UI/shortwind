import { StripeSubscriptions } from "@convex-dev/stripe";
import { components } from "../_generated/api.js";
import type { ActionCtx, QueryCtx } from "../_generated/server.js";
import { customerKey, type BillingScope } from "../lib/billing_scope.js";
import { isActiveStatus } from "./plans.js";

/**
 * Stripe billing wrapper (ported from Realm's `billingStripe/lib.ts`).
 *
 * The rest of the app imports from this module, never from `@convex-dev/stripe`
 * directly. The single behavioural change from Realm is the scope: Realm keys
 * subscriptions/customers by `orgId`; Shortwind keys by `accountId`. The
 * component's key parameters are still literally named `orgId` / `userId` (they
 * are opaque to it), so we feed our account id into them via `scope.accountId`
 * and `customerKey(scope)` — see `../lib/billing_scope.ts`.
 *
 * Like `billing.ts` / `dashboard.ts`, the `components.stripe` reference and the
 * `internal.*` / `api.*` entries for this module only resolve after `convex
 * dev` regenerates `_generated/`. That codegen needs a `CONVEX_DEPLOYMENT`,
 * which is unavailable in this repo's offline checkout — so these
 * component-touching files finalize on the first `convex dev` / deploy.
 */

/**
 * Single shared client. The component picks up `STRIPE_SECRET_KEY` from Convex
 * env at call time — instantiation here is cheap and stateless.
 */
export const stripeClient = new StripeSubscriptions(components.stripe, {});

/**
 * Resolve the active billing subscription for a scope, or `null` if the scope
 * has never had one. Picks the active sub with the furthest-out period end;
 * with one paid tier this is almost always a single row, and the sort defends
 * against legacy upgrades where two active rows briefly co-exist.
 */
export async function activeSubscription(
  ctx: QueryCtx | ActionCtx,
  scope: BillingScope,
) {
  const subs = await ctx.runQuery(
    components.stripe.public.listSubscriptionsByOrgId,
    // The component's `orgId` param is our account id (opaque key).
    { orgId: scope.accountId },
  );

  const active = subs.filter((s) => isActiveStatus(s.status));
  if (active.length === 0) return null;
  return active.sort((a, b) => b.currentPeriodEnd - a.currentPeriodEnd)[0];
}

/**
 * Returns the Stripe customer id linked to this scope, or `null` if none
 * exists yet. The component indexes customers by its `userId` field; we feed
 * `customerKey(scope)` (the account id) into that index.
 */
export async function getCustomerId(
  ctx: QueryCtx | ActionCtx,
  scope: BillingScope,
): Promise<string | null> {
  const customer = await ctx.runQuery(
    components.stripe.public.getCustomerByUserId,
    { userId: customerKey(scope) },
  );
  return customer?.stripeCustomerId ?? null;
}
