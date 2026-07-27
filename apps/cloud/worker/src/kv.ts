/**
 * KV hot cache — hostname/path → route record.
 *
 * The serve hot path (PRD §6.1) must resolve a request to a page version
 * without hitting Convex on every view. KV is the edge-replicated cache; Convex
 * is the cold system of record (PRD §6.3). On a KV miss the caller falls back
 * to Convex (an injected async fn, so this module has zero Convex dependency —
 * CLOUD-22 passes the real query, tests pass a stub) and the result is written
 * back into KV.
 *
 * A `CachedRoute` carries exactly what the router needs to serve or refuse
 * without a DB read: the page/account identity the stable R2 key is derived from,
 * plus lifecycle/visibility so the router can return 410 (tombstoned), 451-style
 * sealed (quarantined), or gate a private page.
 *
 * #232 — VERSION-INDEPENDENT BY DESIGN. The record used to carry `version` +
 * the hashed `artifactKey`, both of which change on every republish, so the
 * cached record was stale the instant a page was updated and only the 1h TTL
 * cleared it. Nothing here changes on a republish now: the artifact is served
 * from the stable `current.html` key derived from `accountId` + `pageId`
 * (./r2.ts `currentArtifactKey`), which publish overwrites in place.
 */
import type { Env } from "./env.js";
import type { PageLifecycle, PageVisibility } from "../../shared/src/types.js";

/**
 * The cached resolution of a public URL. Plain serializable data (CLAUDE.md):
 * it is JSON-stringified into KV.
 */
export interface CachedRoute {
  pageId: string;
  accountId: string;
  lifecycle: PageLifecycle;
  visibility: PageVisibility;
  /**
   * An EXPLICIT R2 key that overrides the stable page key. Set ONLY for a bundle
   * sibling file (`bundles/<acct>/<page>/<path>/<hash>.html`), which is a
   * different document from the entry page and therefore is NOT at the entry's
   * `current.html`. Absent for an ordinary page route.
   */
  fileKey?: string;
  /**
   * MIGRATION SHIM (#232). The current version's immutable hashed key, used ONLY
   * when the stable `current.html` object does not exist — i.e. a page last
   * published BEFORE this change shipped, whose bucket has no `current.html`
   * yet. Self-healing: the first republish after deploy writes `current.html`,
   * after which this field is never read again. Safe despite being
   * version-coupled precisely because it is only consulted when `current.html`
   * is absent, which means the page has not been republished since the record
   * was resolved.
   */
  fallbackArtifactKey?: string;
}

/**
 * Narrow an unknown JSON value (a KV read or a cold-source response) to a
 * {@link CachedRoute}. Anything off-shape resolves to `null`, which the caller
 * treats as a miss — the router then re-resolves cold and, failing that, 404s.
 * It never serves from a record it could not verify.
 *
 * MIGRATION (#232): a record carrying the PRE-fix fields (`version` /
 * `artifactKey`) is deliberately REJECTED. Those records pin a page to one
 * version's R2 key, so honoring them would keep serving the old version for up
 * to the 1h TTL after deploy. Rejecting makes the next request a cold miss that
 * re-resolves against Convex and writes the version-independent record back.
 */
export function asCachedRoute(value: unknown): CachedRoute | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  // Pre-#232 shape → treat as a miss (re-resolve cold), never serve.
  if (r.version !== undefined || r.artifactKey !== undefined) return null;
  if (typeof r.pageId !== "string" || typeof r.accountId !== "string") return null;
  if (r.fileKey !== undefined && typeof r.fileKey !== "string") return null;
  if (
    r.fallbackArtifactKey !== undefined &&
    typeof r.fallbackArtifactKey !== "string"
  ) {
    return null;
  }
  if (
    r.lifecycle !== "active" &&
    r.lifecycle !== "quarantined" &&
    r.lifecycle !== "tombstoned"
  ) {
    return null;
  }
  if (
    r.visibility !== "public" &&
    r.visibility !== "unlisted" &&
    r.visibility !== "private"
  ) {
    return null;
  }
  return value as unknown as CachedRoute;
}

/**
 * Async fn the router injects to load a route from the cold source (Convex) on
 * a KV miss. Returns `null` when no page maps to host/path. Kept as a plain
 * function type so this module never imports Convex.
 */
export type ColdRouteSource = (
  host: string,
  path: string,
) => Promise<CachedRoute | null>;

/**
 * TTL for cached route entries, in seconds. Publish does NOT need to touch this
 * record at all (#232 — nothing in it is version-coupled); the paths that DO
 * change it (delete/kill/expire, visibility flips) evict eagerly. So this is only
 * a backstop against a missed eviction.
 */
const ROUTE_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Canonical KV key for a route. Host is lowercased; path is normalized to a
 * leading slash so `example.com` + `about` and `example.com` + `/about` collide
 * on the same entry.
 */
export function routeKey(host: string, path: string): string {
  const h = host.toLowerCase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `route:${h}${p}`;
}

/**
 * Read a route from KV. Returns `null` on miss OR on an unrecognized record
 * (see {@link asCachedRoute} — a pre-#232, version-coupled record is treated as
 * a miss so the caller re-resolves against Convex instead of serving stale).
 */
export async function lookupRoute(
  env: Env,
  host: string,
  path: string,
): Promise<CachedRoute | null> {
  const raw = await env.ROUTES.get(routeKey(host, path), "json");
  return asCachedRoute(raw);
}

/** Write/refresh a route in KV (called after a cold hit and on publish). */
export async function putRoute(
  env: Env,
  host: string,
  path: string,
  record: CachedRoute,
): Promise<void> {
  await env.ROUTES.put(routeKey(host, path), JSON.stringify(record), {
    expirationTtl: ROUTE_TTL_SECONDS,
  });
}

/**
 * Evict a route from KV.
 *
 * CLOUD-21's `invalidateRoute` (./cache.ts) only purges the edge *Cache*; it
 * leaves the ROUTES KV entry in place, so a tombstone/delete would keep being
 * re-served from KV until its TTL lapsed. The §8.2 kill path and publish/delete
 * therefore also need to drop the KV record so the next request re-resolves
 * against Convex (cold) and sees the new — or absent — route. This is the small,
 * additive KV-side companion to the edge-cache purge.
 *
 * Idempotent: deleting an absent key is a no-op (KV `delete` does not error).
 */
export async function deleteRoute(
  env: Env,
  host: string,
  path: string,
): Promise<void> {
  await env.ROUTES.delete(routeKey(host, path));
}

/**
 * Resolve a route with KV-first / Convex-cold fallback.
 *  - KV hit  → return it, no cold call.
 *  - KV miss → call `coldSource` exactly once; on a non-null result populate KV
 *    and return it; on null return null (router → 404).
 */
export async function resolveRouteWithFallback(
  env: Env,
  host: string,
  path: string,
  coldSource: ColdRouteSource,
): Promise<CachedRoute | null> {
  const cached = await lookupRoute(env, host, path);
  if (cached !== null) return cached;

  const cold = await coldSource(host, path);
  if (cold === null) return null;

  await putRoute(env, host, path, cold);
  return cold;
}
