import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth client for the operator dashboard.
 *
 * Same-origin by default: requests go to the dashboard's own `/api/auth/*`
 * route, which the TanStack Start handler (lib/auth-server.ts) proxies to the
 * Convex Better Auth origin (convex.site). Same-origin keeps the session cookie
 * first-party, exactly like nyxe-mail/apps/web. `convexClient()` MUST be first
 * in `plugins` so the resulting session token authenticates Convex queries.
 */
export const authClient = createAuthClient({
  plugins: [convexClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
