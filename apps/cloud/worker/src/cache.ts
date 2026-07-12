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
  // Short edge TTL (60s), NOT a day. The edge cache (caches.default) sits in
  // FRONT of the KV route lookup, so a long TTL means a deleted/updated/killed
  // page keeps serving its stale cached artifact for the whole TTL even after the
  // lifecycle path eagerly evicts the KV route (edge_kv.ts) — the eviction can't
  // reach an already-cached entry. The instant fix — a Cloudflare zone
  // purge-by-URL on republish/delete/kill — IS now wired on the Convex side
  // (convex/lib/cloudflare_cache.ts `purgeEdgeByUrl`, driven by pages.ts publish +
  // the scheduled edge_kv eviction; #207/#165), so takedowns are seconds, not a
  // minute. The 60s TTL remains the fail-safe floor when a purge can't run (a
  // deployment whose CF token lacks `Cache Purge` zone permission). Artifacts are
  // immutable per version, so re-fetching on miss is cheap (R2 read + fast KV
  // resolve).
  const seconds = init?.cacheSeconds ?? 60; // 60s edge TTL (see above)
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
 * The canonical edge-cache key for a request/URL: `(host, pathname)` with the
 * query string STRIPPED (audit #4). Route resolution keys on `(host, path)` only,
 * so caching under the full URL let an attacker prime unbounded `?x=N` variants of
 * any public page (cache poisoning/flooding) and let a poisoned variant shadow the
 * canonical entry. Normalizing put + delete to the query-less key closes that.
 */
export function edgeCacheKey(url: string | URL): string {
  const u = typeof url === "string" ? new URL(url) : new URL(url.toString());
  u.search = "";
  return u.toString();
}

/**
 * Edge read-through (audit #154): look up a previously-cached response for this
 * URL, or null on a miss. ONLY public artifacts are ever written to the edge
 * (the router puts behind a `visibility === "public"` guard), so a hit is always
 * an auth-free public page — safe to return as-is, skipping the KV route lookup
 * and R2 read entirely. Staleness is bounded by the 60s artifact TTL and the
 * eager `invalidateRoute` on delete/kill/visibility-flip. Same normalized
 * `(host, pathname)` key as put/delete (audit #4 — query stripped).
 */
export async function edgeCacheMatch(url: string | URL): Promise<Response | null> {
  const hit = await edgeCache().match(edgeCacheKey(url));
  return hit ?? null;
}

/**
 * Purge the edge cache entry for a URL. Called by publish/update/delete to
 * invalidate a route so the next request re-resolves and re-streams the new (or
 * absent) artifact. Returns whether an entry was actually deleted. Uses the same
 * normalized `(host, pathname)` key as the put (audit #4).
 *
 * `env` is accepted (unused today) so the signature is stable when CLOUD-30
 * wires an account-scoped zone purge alongside the per-URL Cache API delete.
 */
export async function invalidateRoute(
  _env: Env,
  url: string | URL,
): Promise<boolean> {
  return edgeCache().delete(edgeCacheKey(url));
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
