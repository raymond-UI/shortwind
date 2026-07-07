/**
 * Stripe-side plan resolution.
 *
 * Ported verbatim (behaviour-identical) from Realm's
 * `convex/features/billingStripe/plans.ts` — only the import path for the plan
 * catalog changes (`@convex/billing/plans` → `../lib/billing_plans.js`). This
 * file is PURE (no Convex ctx, no component) and is covered by `plans.test.ts`,
 * which runs offline.
 *
 * Stripe price ids are env-driven so test/live prices swap without code
 * changes. To add a plan: add the id to `PLAN_IDS`, declare its env var,
 * extend `priceToPlan`, and (if checkout-able) extend `planToPriceId`.
 */

import { ConvexError } from "convex/values";
import { type PlanId } from "../lib/billing_plans.js";

function readPriceId(envVar: string): string | null {
  const value = process.env[envVar];
  return value && value.length > 0 ? value : null;
}

/**
 * Resolve a Stripe price id back to a plan id. Returns `null` for prices that
 * aren't part of our catalog (legacy prices, deleted plans).
 */
export function priceToPlan(priceId: string): PlanId | null {
  const proPriceId = readPriceId("STRIPE_PRO_PRICE_ID");
  if (proPriceId && priceId === proPriceId) return "pro";
  return null;
}

/**
 * Resolve a plan id to its checkout price id. Returns `null` for free (no
 * checkout) and unknown plans.
 */
export function planToPriceId(plan: PlanId): string | null {
  if (plan === "pro") return readPriceId("STRIPE_PRO_PRICE_ID");
  return null;
}

/**
 * Subscription statuses Stripe considers "the customer has access right now."
 * `past_due` and `unpaid` are intentionally excluded — those are dunning
 * states that should gate access until the customer pays.
 */
export const ACTIVE_STATUSES: ReadonlyArray<string> = ["active", "trialing"];

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Pure mapping from an active subscription to its catalog plan id. Throws
 * `BILLING_UNKNOWN_PRICE` when the sub's `priceId` isn't in the catalog
 * (legacy price, env mid-rotation, deleted price). Callers must surface this —
 * silently downgrading an actively-paying account to `free` is worse than a
 * loud failure ops can fix by reconciling envs.
 */
export function subscriptionToPlan(sub: {
  stripeSubscriptionId: string;
  priceId: string;
}): PlanId {
  const plan = priceToPlan(sub.priceId);
  if (!plan) {
    throw new ConvexError({
      code: "BILLING_UNKNOWN_PRICE",
      message: `Subscription ${sub.stripeSubscriptionId} uses price "${sub.priceId}" which is not in the plan catalog. Check STRIPE_*_PRICE_ID env config.`,
    });
  }
  return plan;
}
