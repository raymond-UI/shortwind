import type { HttpRouter } from "convex/server";
import { components } from "../_generated/api.js";
import { registerRoutes as registerStripeRoutes } from "@convex-dev/stripe";

/**
 * Stripe webhook route (ported from Realm's `billingStripe/http.ts`).
 *
 * `registerRoutes` mounts a single signature-verified POST handler at
 * `webhookPath` and dispatches the default events (customer.*, subscription.*,
 * invoice.*, checkout.session.completed, payment_intent.*) to the component's
 * own upsert-style internal mutations — so it is idempotent against duplicate
 * webhook deliveries, and needs no processed-event-id table in v1.
 *
 * Any custom side effect added later (audit-log write, abuse signal, etc.) must
 * own its own dedupe — the component does not track processed event ids.
 *
 * The path is fixed at `/stripe/webhook` so the Stripe dashboard endpoint URL
 * stays stable across deployments. Register it AFTER `authComponent.
 * registerRoutes` in `convex/http.ts` (the auth routes stay untouched).
 */
export function registerBillingStripeRoutes(http: HttpRouter): void {
  registerStripeRoutes(http, components.stripe, {
    webhookPath: "/stripe/webhook",
  });
}
