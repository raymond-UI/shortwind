import { action, internalQuery } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { ConvexError, v } from "convex/values";
import { requireWriteOperator } from "../lib/operator_auth.js";
import { customerKey, type BillingScope } from "../lib/billing_scope.js";
import { activeSubscription, getCustomerId, stripeClient } from "./lib.js";
import { PLAN_IDS } from "../lib/billing_plans.js";
import { planToPriceId } from "./plans.js";

/**
 * Checkout + customer-portal actions, ported from Realm's
 * `billingStripe/actions.ts`.
 *
 * Two Shortwind-specific adaptations:
 *
 * 1. Scope. Realm scopes to `identity.organization.id`; we scope to the
 *    account id, fed into the Stripe component's opaque `orgId`/`userId` slots
 *    (see `../lib/billing_scope.ts`).
 *
 * 2. Action-side auth. Shortwind's operator guards need a `db` reader, which an
 *    `action` ctx does not have. So — exactly like `pages.publish` → `pages.
 *    authForWrite` — the `manage` check is a tiny `internalQuery` the action
 *    calls via `ctx.runQuery`. `requireWriteOperator` accepts a bearer
 *    (`pages:write`-scoped agent token) OR a logged-in dashboard session; only
 *    those may start a checkout or open the portal.
 */

/** Manage-gate for the billing actions (bearer with `pages:write`, or session). */
export const authManage = internalQuery({
  args: { bearer: v.optional(v.string()) },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.union(v.id("tokens"), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWriteOperator(ctx, args.bearer);
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  },
});

/**
 * Absolute base URL the checkout/portal redirects return to — the DASHBOARD
 * origin (where `/dashboard/billing` lives), NOT `SITE_URL` (which is the Convex
 * backend `*.convex.site`). `DASHBOARD_URL` is a comma-separated allow-list of
 * origins (CORS); the FIRST entry is the canonical dashboard ORIGIN.
 *
 * The dashboard (TanStack Start) is served under the `/cloud` BASEPATH, and the
 * billing surface is now a real deep-linkable route (#212): the Billing section
 * lives at `/cloud/dashboard/billing`. So checkout/portal return there directly.
 */
const DASHBOARD_BILLING_PATH = "/cloud/dashboard/billing";

function dashboardBillingUrl(query = ""): string {
  const raw = process.env.DASHBOARD_URL;
  const origin = (raw ?? "").split(",")[0].trim().replace(/\/+$/, "");
  if (!origin) {
    throw new ConvexError({
      code: "BILLING_DASHBOARD_URL_NOT_CONFIGURED",
      message:
        "DASHBOARD_URL is not set. `npx convex env set DASHBOARD_URL https://…`.",
    });
  }
  return `${origin}${DASHBOARD_BILLING_PATH}${query}`;
}

/**
 * Start a checkout for the account. Returns the Stripe-hosted URL the client
 * redirects to. The account's customer is created lazily on first checkout via
 * the component's idempotent `getOrCreateCustomer`; `subscriptionMetadata`
 * carries the account id into the row's indexed `orgId` column so
 * `listSubscriptionsByOrgId` resolves the resulting subscription.
 */
export const createCheckoutSession = action({
  args: {
    plan: v.union(...PLAN_IDS.map((p) => v.literal(p))),
    bearer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.billingStripe.actions.authManage, {
      bearer: args.bearer,
    });
    const scope: BillingScope = { type: "account", accountId: auth.accountId };

    if (args.plan === "free") {
      throw new ConvexError({
        code: "BILLING_NO_CHECKOUT_FOR_FREE",
        message: "Free plan does not require checkout.",
      });
    }
    const priceId = planToPriceId(args.plan);
    if (!priceId) {
      throw new ConvexError({
        code: "BILLING_PRICE_NOT_CONFIGURED",
        message: `No Stripe price configured for plan "${args.plan}". Set STRIPE_${args.plan.toUpperCase()}_PRICE_ID.`,
      });
    }

    // Guard against double-subscribing. The UI hides the upgrade button when a
    // sub is active, but the endpoint must not trust the caller — a replayed
    // call would otherwise create a duplicate Stripe subscription. Plan changes
    // go through the customer portal (`portalUrl`), not back through checkout.
    const existing = await activeSubscription(ctx, scope);
    if (existing) {
      throw new ConvexError({
        code: "BILLING_ALREADY_SUBSCRIBED",
        message:
          "This account already has an active subscription. Use the customer portal to change plans.",
      });
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: customerKey(scope),
    });

    const session = await stripeClient.createCheckoutSession(ctx, {
      priceId,
      customerId: customer.customerId,
      mode: "subscription",
      successUrl: dashboardBillingUrl("?checkout=success"),
      cancelUrl: dashboardBillingUrl("?checkout=canceled"),
      // Lands on the subscription row's indexed `orgId` column (our account id).
      subscriptionMetadata: { orgId: scope.accountId },
      metadata: {
        scopeType: "account",
        accountId: scope.accountId,
        actorTokenId: auth.tokenId ?? "session",
      },
    });

    if (!session.url) {
      throw new ConvexError({
        code: "BILLING_CHECKOUT_NO_URL",
        message: "Stripe did not return a checkout URL.",
      });
    }
    return { url: session.url };
  },
});

/**
 * Return the Stripe-hosted customer portal URL for the account. Errors if the
 * account has no Stripe customer yet (has never started a checkout).
 */
export const portalUrl = action({
  args: { bearer: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.billingStripe.actions.authManage, {
      bearer: args.bearer,
    });
    const scope: BillingScope = { type: "account", accountId: auth.accountId };

    const customerId = await getCustomerId(ctx, scope);
    if (!customerId) {
      throw new ConvexError({
        code: "BILLING_NO_CUSTOMER",
        message: "This account has no billing history yet.",
      });
    }

    const session = await stripeClient.createCustomerPortalSession(ctx, {
      customerId,
      returnUrl: dashboardBillingUrl(),
    });
    return { url: session.url };
  },
});
