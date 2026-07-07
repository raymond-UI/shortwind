import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { requireReadOperator } from "../lib/operator_auth.js";
import { FREE_PLAN } from "../lib/billing_plans.js";
import { activeSubscription } from "./lib.js";
import { subscriptionToPlan } from "./plans.js";

/**
 * The account's billing summary — one round-trip for the dashboard: plan id,
 * whether the sub is active, and the period-end timestamp shown alongside the
 * current plan.
 *
 * Ported from Realm's `billingStripe/queries.ts`. Auth is re-based onto
 * Shortwind's operator model: Realm gated on `requirePermission("billing",
 * "read")`; here we route through `requireReadOperator` — the exact guard
 * `billing.getUsage` already uses, so a read-scoped `swc_…` bearer (agent) OR a
 * logged-in dashboard session both resolve, and the result is account-scoped.
 * The read/manage split lives at the action layer (`createCheckoutSession`,
 * `portalUrl` require `requireWriteOperator`).
 */
export const summary = query({
  args: { bearer: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireReadOperator(ctx, args.bearer);
    const scope = { type: "account" as const, accountId: auth.accountId };
    const sub = await activeSubscription(ctx, scope);
    const plan = sub ? subscriptionToPlan(sub) : FREE_PLAN;
    return {
      plan,
      hasActive: sub !== null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  },
});
