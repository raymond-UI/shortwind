import { useState } from "react";
import { useDashboardData } from "../lib/data";
import type { PlanId } from "../lib/types";

/**
 * Billing view — the account's plan + Stripe checkout/portal entry points.
 * Ported from Realm's `billingStripe` plan card, restyled to the dashboard's
 * recipe classes (`@stat`, `@btn-outline`) and re-based onto Shortwind's
 * account model: there are no org roles, so the signed-in operator always
 * manages their own account's plan (no `canManage` gate).
 *
 * Reads `billing` from the data seam and calls `startCheckout` / `openPortal`
 * (which resolve to Stripe-hosted URLs) — the view never imports Convex, so it
 * renders under jsdom with fixtures like every other view.
 */

const PLAN_LABEL: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
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

  if (billing === undefined) {
    return <div className="@muted">Loading billing…</div>;
  }

  const periodLabel = formatPeriodEnd(billing.currentPeriodEnd);
  const renewalText = (() => {
    if (billing.plan === "free") return "No active subscription.";
    if (billing.cancelAtPeriodEnd && periodLabel)
      return `Cancels on ${periodLabel}.`;
    if (periodLabel) return `Renews on ${periodLabel}.`;
    return null;
  })();

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
    <div className="space-y-4" data-testid="billing-view">
      <p className="@caption">
        Custom domains require a paid plan — publishing and serving stay free.
      </p>

      <div className="@card space-y-3">
        <div className="@stat">
          <div className="@stat-value" data-testid="billing-plan">
            {PLAN_LABEL[billing.plan]}
            {billing.hasActive && billing.plan !== "free" ? (
              <span className="@caption ml-2" data-testid="billing-active">
                · Active
              </span>
            ) : null}
          </div>
          <div className="@stat-label">Current plan</div>
          {renewalText ? (
            <div className="@caption" data-testid="billing-renewal">
              {renewalText}
            </div>
          ) : null}
        </div>

        <div className="@row">
          {billing.hasActive ? (
            <button
              type="button"
              className="@btn-outline shrink-0"
              disabled={busy !== null}
              onClick={onManage}
              data-testid="billing-manage"
            >
              {busy === "portal" ? "Opening…" : "Manage subscription"}
            </button>
          ) : (
            <button
              type="button"
              className="@btn-outline shrink-0"
              disabled={busy !== null}
              onClick={onUpgrade}
              data-testid="billing-upgrade"
            >
              {busy === "checkout" ? "Starting…" : "Upgrade to Pro"}
            </button>
          )}
        </div>

        {error ? (
          <p className="@caption text-destructive" data-testid="billing-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
