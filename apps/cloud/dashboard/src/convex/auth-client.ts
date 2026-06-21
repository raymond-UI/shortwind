import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth client for the dashboard (CLOUD-35), mirroring the
 * nyxe-mail/Togethr pattern: `convexClient()` MUST be first in `plugins`. The
 * operator signs in here; the resulting session token authenticates the Convex
 * queries.
 *
 * `baseURL` points at the Better Auth HTTP origin. Offline it falls back to the
 * current window origin; CLOUD-30b sets `VITE_BETTER_AUTH_URL` to the deployed
 * auth origin.
 */
const baseURL =
  (import.meta.env.VITE_BETTER_AUTH_URL as string | undefined) ??
  (typeof window !== "undefined" ? window.location.origin : "");

export const authClient = createAuthClient({
  baseURL,
  plugins: [convexClient()],
});

export const { useSession, signIn, signOut } = authClient;
