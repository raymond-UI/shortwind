import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth client for the operator dashboard.
 *
 * Same-origin: requests go to the dashboard's own `/cloud/api/auth/*` route,
 * which the TanStack Start handler (lib/auth-server.ts) proxies to the Convex
 * Better Auth origin (convex.site). Same-origin keeps the session cookie
 * first-party, exactly like nyxe-mail/apps/web. `convexClient()` MUST be first
 * in `plugins` so the resulting session token authenticates Convex queries.
 *
 * The app is served under `/cloud` (routed at https://shortwind.dev/cloud), so
 * the auth endpoint lives at `<origin>/cloud/api/auth`. We pass `basePath`
 * (the PATH only, not a full URL) so better-auth resolves the endpoint against
 * whatever origin the app is loaded from — it works both on
 * `shortwind.dev/cloud` and directly on the `*.workers.dev/cloud` origin.
 */
export const authClient = createAuthClient({
  basePath: "/cloud/api/auth",
  plugins: [convexClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
