import { createFileRoute } from "@tanstack/react-router";
import { handler } from "@/lib/auth-server";

/**
 * Same-origin Better Auth proxy (mirrors nyxe-mail/apps/web/src/routes/api/auth/$.ts).
 * `convexBetterAuthReactStart`'s handler forwards the request's pathname
 * verbatim to the Convex Better Auth origin (convex.site).
 *
 * Two transforms happen here:
 *  1. We stamp `x-forwarded-host`/`-proto` with the real dashboard origin so
 *     Better Auth's host-aware baseURL keeps cookies first-party to this origin.
 *  2. The app is served under `/cloud`, so this route receives requests at
 *     `/cloud/api/auth/*`. Convex Better Auth expects `/api/auth/*` (it has no
 *     `/cloud` base), so we STRIP the `/cloud` prefix from the URL we hand the
 *     handler — otherwise it would proxy to `convex.site/cloud/api/auth/*` and 404.
 */
const BASE_PREFIX = "/cloud";

function withForwardedOrigin(request: Request): Request {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  // Strip the `/cloud` base so the upstream pathname is `/api/auth/*`.
  if (url.pathname.startsWith(`${BASE_PREFIX}/`)) {
    url.pathname = url.pathname.slice(BASE_PREFIX.length);
  }
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as { duplex?: "half" }).duplex = "half";
  }
  return new Request(url.toString(), init);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(withForwardedOrigin(request)),
      POST: ({ request }) => handler(withForwardedOrigin(request)),
    },
  },
});
