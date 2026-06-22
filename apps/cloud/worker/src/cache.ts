/**
 * Edge cache helpers.
 *
 * The hot path caches the served artifact response at the Cloudflare edge so a
 * viral page costs almost nothing to serve (PRD §6.1, §6.4). Publish/update/
 * delete must purge that edge entry for the affected URL so the next request
 * re-resolves (the kill path in PRD §8.2 depends on this being clean: one
 * object, one cache key).
 *
 * We use the Worker `caches.default` Cache API. The cache key is the request
 * URL; `invalidateRoute` deletes that key. (Account-wide CDN purges are a later
 * CLOUD-30 concern; the per-URL Cache API delete is the in-Worker primitive.)
 */
import type { Env } from "./env.js";
import type { ArtifactObject } from "./r2.js";

/**
 * Build a cacheable `Response` that streams an R2 artifact body, tagged so the
 * edge can store it. The router returns this; passing `ctx.waitUntil(cache.put)`
 * is the router's job (CLOUD-22) — here we just shape the response + headers.
 */
export function cacheArtifactResponse(
  artifact: ArtifactObject,
  init?: { cacheSeconds?: number },
): Response {
  const seconds = init?.cacheSeconds ?? 60 * 60 * 24; // 1 day default
  const headers = new Headers();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", `public, max-age=${seconds}`);
  // Let conditional requests + edge revalidation key off the frozen content.
  headers.set("etag", `"${artifact.meta.expandedHash}"`);
  artifact.object.writeHttpMetadata(headers);
  // writeHttpMetadata may overwrite content-type from stored httpMetadata; the
  // artifact is always text/html so re-assert it.
  headers.set("content-type", "text/html; charset=utf-8");
  // SECURITY (audit #3). Primary isolation of untrusted page content is the
  // dedicated `shortwind.app` apex (no shared cookie/origin trust with the
  // dashboard). These headers are defense-in-depth that DON'T break arbitrary
  // author HTML:
  //   - nosniff: never let a mistyped artifact be sniffed into a script/other type.
  //   - COOP: a page can't get a window handle to its opener (popup attacks).
  //   - CORP cross-origin: explicit — artifacts are public, embeddable anywhere.
  // A content-restricting CSP is deliberately NOT imposed (it would break the
  // arbitrary inline JS/CSS pages this product exists to host); per-page opt-in
  // CSP + adding `shortwind.app` to the Public Suffix List (to isolate page
  // subdomains from each other, like vercel.app) are the documented follow-ups.
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "cross-origin");
  return new Response(artifact.object.body, { status: 200, headers });
}

/**
 * Purge the edge cache entry for a URL. Called by publish/update/delete to
 * invalidate a route so the next request re-resolves and re-streams the new (or
 * absent) artifact. Returns whether an entry was actually deleted.
 *
 * `env` is accepted (unused today) so the signature is stable when CLOUD-30
 * wires an account-scoped zone purge alongside the per-URL Cache API delete.
 */
export async function invalidateRoute(
  _env: Env,
  url: string | URL,
): Promise<boolean> {
  const key = typeof url === "string" ? url : url.toString();
  return edgeCache().delete(key);
}

/**
 * The Worker default edge cache (`caches.default`). The root tsconfig pulls in
 * both the DOM lib and `@cloudflare/workers-types`; the DOM `CacheStorage` lacks
 * the Workers-only `.default` member, so we narrow the global to the Workers
 * Cache API here rather than widen the whole project's lib config.
 */
function edgeCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}
