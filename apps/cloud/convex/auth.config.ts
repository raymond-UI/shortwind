import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

/**
 * Convex deployment auth config (CLOUD-30b).
 *
 * Convex validates the JWT a websocket client presents against the providers
 * declared HERE (the deployment-level `auth.config.ts` Convex looks for at
 * push time). Without it, an authenticated Convex query over the socket fails
 * with "No auth provider found matching the given token". `auth.ts` also passes
 * the same provider to the `convex()` Better Auth plugin for the HTTP routes,
 * but that does NOT register it with the deployment — this file is what does.
 *
 * `getAuthConfigProvider()` builds the `customJwt` provider whose issuer is the
 * Convex site origin (`CONVEX_SITE_URL`) and applicationID `convex`, matching
 * the tokens Better Auth's `convex` plugin mints.
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
