import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

/**
 * Convex app component registration (CLOUD-01).
 *
 * The `@convex-dev/better-auth` component owns the auth tables (user, session,
 * account, verification, plus the device-authorization rows) — they live inside
 * the component, not in `schema.ts`. Registering it here is what makes
 * `components.betterAuth` available to `convex/auth.ts`.
 *
 * Later waves (`app.use(...)`) add the rate-limiter component when the HTTP
 * surface lands; kept minimal here per CLOUD-01 scope.
 */
const app = defineApp();
app.use(betterAuth);

export default app;
