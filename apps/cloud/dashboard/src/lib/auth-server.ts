import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

/**
 * Server-side Better Auth wiring (mirrors nyxe-mail/apps/web/src/lib/auth-server.ts).
 *
 * `handler` proxies the dashboard's `/api/auth/*` requests to the Convex Better
 * Auth origin; `getToken` reads the Convex JWT from the request cookies during
 * SSR so the root route can seed an authenticated Convex client.
 *
 * Reads `process.env` first (Worker runtime) then `import.meta.env` (build-time
 * inline). `convexSiteUrl` defaults to the convex.cloud → convex.site convention.
 */
const env = (typeof process !== "undefined" ? process.env : {}) as Record<
  string,
  string | undefined
>;

const convexUrl = (env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL)!;
const convexSiteUrl =
  env.VITE_CONVEX_SITE_URL ??
  import.meta.env.VITE_CONVEX_SITE_URL ??
  convexUrl.replace(/\.convex\.cloud$/, ".convex.site");

export const { handler, getToken } = convexBetterAuthReactStart({
  convexUrl,
  convexSiteUrl,
});
