# Billing — Stripe (ported from Realm)

Stripe-backed billing for Shortwind Cloud. **Copied from** Realm's
`convex/features/billingStripe/` (the `convex-tanstack-saas-starter`) and
re-based onto Shortwind Cloud's subject + auth model. Realm is the upstream
source — port fixes forward from there; do not edit Realm from this repo.

## What changed from Realm

| Realm | Shortwind Cloud |
|---|---|
| Subject = **organization** (`identity.organization.id`) | Subject = **account** (`accounts` row — the meter subject in `billing.ts`) |
| `requirePermission(ctx, "billing", "read"/"manage")` | `requireReadOperator` (read) / `requireWriteOperator` (manage) — the same guards `billing.getUsage` / `pages.publish` use |
| Auth resolved inline in actions | Actions have no `db`; `manage` auth is the `authManage` **internalQuery** called via `ctx.runQuery`, mirroring `pages.authForWrite` |
| `@convex/…` / `@app/…` path aliases | relative `../…` imports with `.js` extensions |
| `getServerEnv().SITE_URL` | `process.env.SITE_URL` (Convex env) |
| Polar sibling module | dropped — Stripe only |

The component still names its opaque customer/subscription key `orgId`/`userId`;
we feed the **account id** into those slots (`billing_scope.ts` → `customerKey`,
and `subscriptionMetadata: { orgId: accountId }`).

## Public surface

- `api.billingStripe.queries.summary` → `{ plan, hasActive, currentPeriodEnd, cancelAtPeriodEnd }`. Read-scoped (bearer or dashboard session).
- `api.billingStripe.actions.createCheckoutSession` → Stripe-hosted checkout URL. Manage-scoped (`pages:write` bearer or session).
- `api.billingStripe.actions.portalUrl` → customer-portal URL. Manage-scoped.

Plan ids (`free`, `pro`) live in `../lib/billing_plans.ts`; this module's
`plans.ts` maps them to Stripe price ids (env-driven). `free` is the implicit
default. `plans.ts` is pure and covered by `plans.test.ts` (runs offline).

## Deploy-gated steps (need a Convex deployment — done by the user)

The component-touching files (`lib.ts`, `queries.ts`, `actions.ts`, `http.ts`)
reference `components.stripe` and `internal.billingStripe.*`, which only resolve
after `convex dev` regenerates `_generated/` — the same offline limitation noted
in `billing.ts` / `dashboard.ts`. To finish wiring:

1. `pnpm install` (pulls `@convex-dev/stripe@0.1.4`).
2. `npx convex dev` once, with `CONVEX_DEPLOYMENT` set — regenerates `_generated/api` so `components.stripe` + this module's endpoints exist and typecheck.
3. Convex env:
   ```
   npx convex env set STRIPE_SECRET_KEY sk_test_…
   npx convex env set STRIPE_WEBHOOK_SECRET whsec_…
   npx convex env set STRIPE_PRO_PRICE_ID price_…
   # DASHBOARD_URL (the checkout/portal return origin) is already set for the
   # dashboard; billing reuses its first comma-separated entry. NOT SITE_URL,
   # which is the Convex backend (*.convex.site).
   ```
4. Stripe dashboard endpoint → `https://<deployment>.convex.site/stripe/webhook`, events: `customer.*`, `customer.subscription.*`, `checkout.session.completed`, `invoice.*`, `payment_intent.*`. The signing secret it shows is `STRIPE_WEBHOOK_SECRET`.

## Not yet done (follow-ups)

- **Frontend**: port Realm's `apps/web/src/features/billingStripe/` into the dashboard (`apps/cloud/dashboard`) — a `/dashboard/billing` route calling `summary` / `createCheckoutSession` / `portalUrl`.
- **Enforcement**: this module tells you the plan; it does not yet gate the write paths. Wire plan limits into `pages.publish` and `domains.ts` (the card-before-custom-domain gate is the anti-phishing lever).
- **Customer enrichment**: `getOrCreateCustomer` is called with only `userId`; pass account email/name once surfaced by the operator guard.
