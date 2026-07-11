/**
 * CLOUD-30 — the LIVE Cloudflare zone cache-purge the publish + lifecycle paths
 * drive so an edit/delete/kill goes live INSTANTLY instead of after the 60s edge
 * TTL (worker/src/cache.ts `cacheArtifactResponse`).
 *
 * The serve Worker caches the artifact response in `caches.default` (the CF edge
 * cache) keyed on the request URL. That edge cache sits in FRONT of the KV route
 * lookup, so evicting the KV route (lib/edge_kv.ts) can't reach an already-cached
 * edge entry — it keeps serving the stale artifact until the TTL lapses. A zone
 * purge-by-URL (`POST /zones/{zoneId}/purge_cache {files:[url]}`) evicts that edge
 * entry directly, so:
 *   - republish (#207): the new artifact serves on the next request, and
 *   - delete/kill/quarantine (#165): a previously-fetched page 404s at the edge
 *     within seconds (critical for the moderation kill-path).
 *
 * This module is the Convex-side companion to the KV eviction in lib/edge_kv.ts;
 * the lifecycle paths run BOTH (KV route + edge cache) from the same scheduled
 * action. It never imports the Worker (CLAUDE.md dependency direction).
 *
 * Fail-safe contract (issue #165 acceptance): a purge failure — network / CF 5xx
 * / a token without `Cache Purge` (zone) permission / missing creds — is logged
 * and SWALLOWED. The purge is a best-effort accelerator; the worst case of a
 * missed purge is the page serving stale for up to the 60s TTL (the prior
 * behavior), never a broken publish or kill. It must never throw to its caller.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Minimal `process.env` accessor. This workspace types against
 * `@cloudflare/workers-types` (no Node `process`), so we declare just the slice
 * we read. Set on the Convex deployment via `npx convex env set`.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Normalize a URL to the EXACT edge-cache key the Worker stores under, so a purge
 * targets the same entry. MUST match worker/src/cache.ts `edgeCacheKey()`:
 * `(host, pathname)` with the query string stripped (audit #4 — the Worker keys
 * puts/reads/deletes on the query-less URL). `new URL(...).toString()` also
 * canonicalizes a bare origin (`https://x.shortwind.app`) to a trailing-slash
 * root path (`https://x.shortwind.app/`), which is how the Worker caches a `/`
 * request — so publish/lifecycle callers can pass either form.
 */
export function edgePurgeUrl(url: string): string {
  const u = new URL(url);
  u.search = "";
  return u.toString();
}

/**
 * Purge the Cloudflare edge cache entry for a single URL via zone purge-by-URL.
 * Returns whether the purge was issued successfully (never throws — see the
 * fail-safe contract above).
 *
 * Env (read at call time, like the CF-for-SaaS client in cloudflare_saas.ts):
 *   - `CLOUDFLARE_API_TOKEN` — a token with `Cache Purge` on the zone.
 *   - `CLOUDFLARE_ZONE_ID`   — the `shortwind.app` zone id (same one the
 *                              custom-hostnames client uses).
 *
 * Absent creds ⇒ skip (return false): keeps publish/kill working in dev/test
 * without Cloudflare creds, exactly as the prior no-op placeholder did.
 */
export async function purgeEdgeByUrl(url: string): Promise<boolean> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!apiToken || !zoneId) {
    // Un-provisioned (dev/test) or a deployment whose token lacks zone scope:
    // nothing to purge against. Not an error — degrades to stale-until-60s-TTL.
    return false;
  }

  const target = edgePurgeUrl(url);
  try {
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: [target] }),
    });
    if (res.ok) return true;
    const detail = await res.text().catch(() => "");
    console.error(
      `[cloudflare_cache] zone purge failed (${res.status}) for ${target}: ${detail.slice(0, 200)}`,
    );
    return false;
  } catch (err) {
    // Network / unexpected error: log + swallow. The 60s edge TTL bounds the
    // staleness; a missed purge is never a broken publish/kill.
    console.error(`[cloudflare_cache] zone purge threw for ${target}:`, err);
    return false;
  }
}
