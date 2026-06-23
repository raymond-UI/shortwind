/**
 * Shortwind Cloud API-proxy Worker — the branded public API origin.
 *
 * Bound to `api.shortwind.dev/*`, it reverse-proxies the PUBLIC Convex HTTP
 * surface and nothing else. Two jobs, both deliberate:
 *
 *   1. Indirection. The Convex deployment slug (`*.convex.site`) is an immutable,
 *      vendor-assigned name. Exposing it as the public origin would bake it into
 *      the OAuth `issuer`, the discovery document, the REST catalog, and the
 *      shipped CLI default — locking the platform to one deployment forever. This
 *      proxy makes `api.shortwind.dev` the stable identity; the slug is a swappable
 *      env var (`CONVEX_HTTP_URL`).
 *
 *   2. Gateway allow-list. Convex's HTTP router also hosts the Worker-only
 *      `/internal/*` cold-source endpoints (route projections incl. artifactKey/
 *      accountId for private/quarantined/tombstoned pages — see convex/http.ts
 *      audit #7). Those must NEVER be reachable from the public origin. The proxy
 *      forwards ONLY the public prefixes below; everything else is a flat 404. So
 *      the branded origin exposes exactly the public contract, defense-in-depth on
 *      top of the `SERVE_INTERNAL_SECRET` gate.
 *
 * The serve path for untrusted USER content is a different Worker on a different
 * registrable domain (`shortwind.app`, worker/src/router.ts) — kept separate so
 * the platform API shares no origin trust with hosted pages (audit #3).
 */
import type { Env } from "./env.js";

/**
 * The public API prefixes this origin forwards. Mirrors the routes registered in
 * convex/http.ts EXCEPT `/internal/*` (Worker-only) — those are intentionally
 * absent so the public origin can't reach them.
 *   - `/v1/`          REST surface (pages CRUD, abuse report)
 *   - `/oauth/`       RFC 8628 device grant (device/code, token)
 *   - `/.well-known/` RFC 8414 / 9727 discovery (auth metadata, api catalog)
 */
export const ALLOWED_PREFIXES = ["/v1/", "/oauth/", "/.well-known/"] as const;

export type ProxyTarget =
  | { ok: true; url: string }
  | { ok: false; reason: "not_allowed" | "not_configured" };

/**
 * PURE: decide where (if anywhere) an incoming request URL forwards to. Keeping
 * this side-effect-free is what makes the proxy testable in the Node pool without
 * a workerd fetch. The path + query are preserved verbatim; only the origin is
 * swapped to the Convex deployment. Trailing slashes on the base are trimmed so
 * `https://x.convex.site/` and `https://x.convex.site` behave identically.
 */
export function resolveProxyTarget(
  requestUrl: string,
  convexBase: string,
): ProxyTarget {
  const base = convexBase.replace(/\/+$/, "");
  if (base.length === 0) return { ok: false, reason: "not_configured" };
  const incoming = new URL(requestUrl);
  const allowed = ALLOWED_PREFIXES.some((p) => incoming.pathname.startsWith(p));
  if (!allowed) return { ok: false, reason: "not_allowed" };
  return { ok: true, url: `${base}${incoming.pathname}${incoming.search}` };
}

/** A small JSON error body matching the API's `{ error: { code, message } }` shape. */
function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const target = resolveProxyTarget(request.url, env.CONVEX_HTTP_URL);
    if (!target.ok) {
      // not_configured → 502 (deploy is missing CONVEX_HTTP_URL; closed-by-default).
      // not_allowed   → 404 (path is outside the public surface, e.g. /internal/*).
      return target.reason === "not_configured"
        ? errorResponse(502, "NOT_CONFIGURED", "API origin is not provisioned.")
        : errorResponse(404, "NOT_FOUND", "No such endpoint.");
    }
    // Rebuild the request against the Convex origin. `new Request(url, request)`
    // copies method, headers, and the body stream; the Host header is derived
    // from the target URL (the runtime owns it), so Convex sees its own host.
    // `redirect: "manual"` relays any 3xx through unchanged rather than the edge
    // following it — the proxy is transparent.
    const proxied = new Request(target.url, request);
    return fetch(proxied, { redirect: "manual" });
  },
};

export default handler;
