import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import stripe from "@convex-dev/stripe/convex.config.js";

/**
 * Convex app component registration (CLOUD-01).
 *
 * The `@convex-dev/better-auth` component owns the auth tables (user, session,
 * account, verification, plus the device-authorization rows) — they live inside
 * the component, not in `schema.ts`. Registering it here is what makes
 * `components.betterAuth` available to `convex/auth.ts`.
 *
 * CLOUD-33 registers the `@convex-dev/rate-limiter` component (additive): it owns
 * the per-account publish rate-limit buckets consumed by `lib/rate_limit.ts`
 * (`components.rateLimiter`). The component is active at deploy; offline tests
 * inject an in-memory limiter (the component's child mutations don't run under
 * `convex-test`) — see `lib/rate_limit.ts`.
 *
 * The `@convex-dev/stripe` component (ported billing, from Realm) owns the
 * customer / subscription tables and the signature-verified webhook handler;
 * registering it makes `components.stripe` available to `convex/billingStripe/*`.
 */
const app = defineApp();
app.use(betterAuth);
app.use(rateLimiter);
app.use(stripe);

export default app;
