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

      <div
        className={
          "rounded-lg border bg-card p-5 " +
          (isPro ? "border-term/40" : "border-border")
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="text-lg font-semibold tracking-tight"
                data-testid="billing-plan"
              >
                {PLAN_LABEL[billing.plan]}
              </span>
              {billing.hasActive && isPro ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-term/40 bg-term/10 px-2 py-0.5 text-xs font-medium text-term"
                  data-testid="billing-active"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-term"
                    aria-hidden="true"
                  />
                  Active
                </span>
              ) : null}
            </div>
            {renewalText ? (
              <div
                className="text-xs text-muted-foreground"
                data-testid="billing-renewal"
              >
                {renewalText}
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold tabular-nums tracking-tight">
              {isPro ? (
                <>
                  <span className="text-term">$5</span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </>
              ) : (
                "$0"
              )}
            </span>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm text-muted-foreground">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-term" aria-hidden="true">
                ▚
              </span>
              <span className="font-mono text-xs sm:text-sm">{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5">
          {billing.hasActive ? (
            <button
              type="button"
              className="@btn-outline w-full sm:w-auto"
              disabled={busy !== null}
              onClick={onManage}
              data-testid="billing-manage"
            >
              {busy === "portal" ? "Opening…" : "Manage subscription"}
            </button>
          ) : (
            <button
              type="button"
              className="sw-btn-primary w-full rounded-md px-4 py-2 text-sm font-semibold sm:w-auto"
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
      </div>
    </div>
  );
}
