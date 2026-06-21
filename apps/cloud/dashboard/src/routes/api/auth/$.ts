import { createFileRoute } from "@tanstack/react-router";
import { handler } from "@/lib/auth-server";

/**
 * Same-origin Better Auth proxy (mirrors nyxe-mail/apps/web/src/routes/api/auth/$.ts).
 * `convexBetterAuthReactStart`'s handler forwards `/api/auth/*` to the Convex
 * Better Auth origin (convex.site). We stamp `x-forwarded-host`/`-proto` with
 * the real dashboard origin so Better Auth's host-aware baseURL keeps cookies
 * first-party to this origin.
 */
function withForwardedOrigin(request: Request): Request {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as { duplex?: "half" }).duplex = "half";
  }
  return new Request(request.url, init);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(withForwardedOrigin(request)),
      POST: ({ request }) => handler(withForwardedOrigin(request)),
    },
  },
});
