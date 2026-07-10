import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonPanel } from "../components/Skeleton";
import type { PlanId } from "../lib/types";

/**
 * Billing view — the account's plan + Stripe checkout/portal entry points.
 * Ported from Realm's `billingStripe` plan card, restyled in the #213 design
 * pass onto the shared theme: a plan card with the term-green accent, the
 * feature list, and the renewal line, matching the landing page's pricing beat.
 * Re-based onto Shortwind's account model: there are no org roles, so the
 * signed-in operator always manages their own account's plan.
 *
 * Reads `billing` from the data seam and calls `startCheckout` / `openPortal`
 * (which resolve to Stripe-hosted URLs) — the view never imports Convex, so it
 * renders under jsdom with fixtures like every other view.
 */

const PLAN_LABEL: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
};

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: [
    "Unlimited publishes",
    "<slug>.shortwind.app URLs",
    "Public / unlisted / private",
    "Free serving — views aren’t billed",
  ],
  pro: [
    "Everything in Free",
    "Bring your own domain",
    "your-domain/<slug>",
    "Auto-issued TLS certificate",
  ],
};

/** Stripe period-end is unix SECONDS; render as a local date. */
function formatPeriodEnd(currentPeriodEnd: number | null): string | null {
  if (!currentPeriodEnd) return null;
  return new Date(currentPeriodEnd * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BillingView() {
  const { billing, startCheckout, openPortal } = useDashboardData();
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The header is static — render it immediately and skeleton only the plan card.
  const header = (
    <SectionHeader
      eyebrow="Billing"
      title="Plan & subscription"
      description="Custom domains require a paid plan — publishing and serving stay free."
    />
  );

  if (billing === undefined) {
    return (
      <div className="max-w-xl space-y-5">
        {header}
        <SkeletonPanel lines={4} label="Loading billing" />
      </div>
    );
  }

  const isPro = billing.plan !== "free";
  const periodLabel = formatPeriodEnd(billing.currentPeriodEnd);
  const renewalText = (() => {
    if (billing.plan === "free") return "No active subscription.";
    if (billing.cancelAtPeriodEnd && periodLabel)
      return `Cancels on ${periodLabel}.`;
    if (periodLabel) return `Renews on ${periodLabel}.`;
    return null;
  })();
  const features = PLAN_FEATURES[billing.plan];

  async function onUpgrade() {
    setBusy("checkout");
    setError(null);
    try {
      const { url } = await startCheckout("pro");
      window.location.href = url;
    } catch {
      setError("Couldn't start checkout. Please try again.");
      setBusy(null);
    }
  }

  async function onManage() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await openPortal();
      window.location.href = url;
    } catch {
      setError("Couldn't open the billing portal. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="max-w-xl space-y-5" data-testid="billing-view">
      {header}

      {/* Same anatomy as the page-detail hero: stat label, big value with
          quiet meta beside it, and a border-separated footer for actions. */}
      <section
        className={
          "@card flex flex-col p-5 " + (isPro ? "border-term/40" : "")
        }
      >
        <div className="flex items-center justify-between">
          <span className="@stat-label">Current plan</span>
          {billing.hasActive && isPro ? (
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="billing-active"
            >
              <span
                className="h-2 w-2 rounded-full bg-term"
                aria-hidden="true"
              />
              Active
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="@stat-value" data-testid="billing-plan">
            {PLAN_LABEL[billing.plan]}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {isPro ? "$5/mo" : "$0"}
          </span>
          {renewalText ? (
            <span
              className="text-xs text-muted-foreground"
              data-testid="billing-renewal"
            >
              · {renewalText}
            </span>
          ) : null}
        </div>

        <ul className="mt-6 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-term" aria-hidden="true">
                ▚
              </span>
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-4">
          {billing.hasActive ? (
            <button
              type="button"
              className="@button-secondary-sm"
              disabled={busy !== null}
              onClick={onManage}
              data-testid="billing-manage"
            >
              {busy === "portal" ? "Opening…" : "Manage subscription"}
            </button>
          ) : (
            <button
              type="button"
              className="@button-primary-sm"
              disabled={busy !== null}
              onClick={onUpgrade}
              data-testid="billing-upgrade"
            >
              {busy === "checkout" ? "Starting…" : "Upgrade to Pro"}
            </button>
          )}
        </div>

        {error ? (
          <p
            className="mt-3 text-xs text-destructive"
            data-testid="billing-error"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
