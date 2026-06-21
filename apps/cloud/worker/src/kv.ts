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
 * without a DB read: the R2 artifact key to stream, plus lifecycle/visibility
 * so the router can return 410 (tombstoned), 451-style sealed (quarantined), or
 * gate a private page.
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
  /** Current version number served by this route. */
  version: number;
  /** R2 key of the frozen artifact to stream (see ./r2.ts `artifactKey`). */
  artifactKey: string;
  lifecycle: PageLifecycle;
  visibility: PageVisibility;
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

/** TTL for cached route entries, in seconds. Publish/delete invalidate eagerly,
 * so this is only a backstop against stale records if an invalidation is missed. */
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

/** Read a route from KV. Returns `null` on miss (caller falls back to Convex). */
export async function lookupRoute(
  env: Env,
  host: string,
  path: string,
): Promise<CachedRoute | null> {
  const raw = await env.ROUTES.get(routeKey(host, path), "json");
  return (raw as CachedRoute | null) ?? null;
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
