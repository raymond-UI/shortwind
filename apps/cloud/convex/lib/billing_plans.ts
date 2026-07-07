/**
 * Plan catalog — single source of truth for the plan ids the app gates on.
 *
 * Ported from Realm's `convex/billing/plans.ts` (the convex-tanstack-saas
 * starter). Provider-specific catalog detail (Stripe price ids, status
 * filters) lives in the provider module's own `plans.ts`
 * (`convex/billingStripe/plans.ts`) — app code gates on these plan ids,
 * never on Stripe price ids.
 *
 * Adding a plan is a three-line change: add the id here, declare its
 * `STRIPE_<PLAN>_PRICE_ID` env var, and extend `priceToPlan` / `planToPriceId`
 * in the provider module.
 */

export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * `free` is the implicit default: any account with no active subscription is
 * treated as `free`, so consumers never have to handle `null`.
 */
export const FREE_PLAN: PlanId = "free";
