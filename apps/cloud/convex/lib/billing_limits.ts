import { type PlanId } from "./billing_plans.js";

/**
 * Plan entitlements — the PURE source of truth for what each plan allows.
 *
 * This is the enforcement policy the write paths gate against. It has no Convex
 * ctx and no Stripe dependency, so it is trivially unit-testable (see
 * `billing_limits.test.ts`) and can be imported anywhere without pulling in the
 * billing component. The *resolution* of an account's plan (which needs the
 * Stripe component) lives behind the `plan_resolver.ts` seam; this module only
 * answers "given a plan, what is allowed?".
 *
 * Design note (PRD §6.4 cost shape): **publishing is cheap** — a publish is one
 * expand + one frozen R2 artifact, and serving is ~free. So we do NOT cap
 * publishes today (`maxPublishes: null` = unlimited on every plan). The cost —
 * and the abuse/phishing surface — is the **custom domain**: each is a
 * Cloudflare-for-SaaS hostname + cert on an attacker-controllable name. So the
 * gate that matters is `customDomains`, and it is the "card-before-custom-domain"
 * anti-phishing lever: `free` gets zero, a paid plan unlocks them.
 */
export interface PlanLimits {
  /** Max simultaneously-bound custom domains. `0` ⇒ the plan cannot bind any. */
  customDomains: number;
  /** Max lifetime publishes, or `null` for unlimited (the default — see note). */
  maxPublishes: number | null;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  // `customDomains` = max simultaneously-ACTIVE account-level domains. One per
  // paid account today; the field is a count so higher tiers can raise it.
  free: { customDomains: 0, maxPublishes: null },
  pro: { customDomains: 1, maxPublishes: null },
};

/**
 * Would binding one more custom domain stay within the plan's quota? `false`
 * blocks the bind. `free` (limit 0) always returns `false` — the entitlement
 * gate that requires an upgrade before any custom domain.
 */
export function withinCustomDomainQuota(
  plan: PlanId,
  currentCount: number,
): boolean {
  return currentCount < PLAN_LIMITS[plan].customDomains;
}

/** Does the plan permit custom domains at all (independent of current count)? */
export function customDomainAllowed(plan: PlanId): boolean {
  return PLAN_LIMITS[plan].customDomains > 0;
}

/**
 * Has the account hit its publish quota? `null` (unlimited) is never exceeded.
 * Wired for completeness / future paid caps; today every plan is unlimited, so
 * the publish path is intentionally not gated (publishing is cheap — §6.4).
 */
export function publishQuotaExceeded(
  plan: PlanId,
  currentPublishes: number,
): boolean {
  const max = PLAN_LIMITS[plan].maxPublishes;
  return max !== null && currentPublishes >= max;
}
