/**
 * CLOUD-30b — the LIVE edge-KV eviction the lifecycle/kill paths drive.
 *
 * `deletePage` (tombstone) and `killPage` (quarantine) flip the page's DB row,
 * but the serve hot path resolves a request KV-first (worker/src/kv.ts): a
 * killed page keeps serving a stale 200 from the ROUTES KV cache until its 1h
 * TTL lapses. To take a page down "in seconds" (PRD §8.2) the cold source must
 * EAGERLY evict the KV route so the next request re-resolves against Convex and
 * sees the tombstone/quarantine.
 *
 * This module is the Convex-side companion to worker/src/kv.ts `deleteRoute`.
 * It can't import the worker (CLAUDE.md dependency direction — Convex never
 * depends on the Worker), so the canonical {@link routeKey} is RE-DERIVED here
 * to MATCH `worker/src/kv.ts` `routeKey(host, path)` byte-for-byte. A change to
 * that function MUST be mirrored here (both are golden-tested).
 *
 * Fail-safe contract: a KV-delete failure (network / Cloudflare 5xx / missing
 * creds) is logged and SWALLOWED — it never throws. The DB tombstone/quarantine
 * + the find-exclusion remain the source of truth; the worst case of a missed
 * eviction is the page serving stale until the 1h TTL (the prior behavior), not
 * a broken kill. The kill/delete mutation must still commit.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server.js";
import { internal } from "../_generated/api.js";

/**
 * Minimal `process.env` accessor. This workspace types against
 * `@cloudflare/workers-types` (no Node `process`), so we declare just the slice
 * we read. These are set on the Convex deployment via `npx convex env set`.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * The serve hostname the Worker runs under — the `url.hostname` the router sees,
 * which is the host half of the KV route key (worker/src/router.ts derives
 * `host = url.hostname`, `path = url.pathname`). The live serve Worker is
 * `shortwind-cloud-serve.mzed-studio.workers.dev`; an env override
 * (`SERVE_HOST`) lets a different deployment retarget without a code change. The
 * hardcoded fallback mirrors how `pageBaseUrl()` hardcodes the public origin.
 */
export function serveHost(): string {
  return process.env.SERVE_HOST ?? "shortwind-cloud-serve.mzed-studio.workers.dev";
}

/**
 * CLOUD-SUBDOMAIN: the apex domain pages are served under as per-page subdomains
 * (`https://<subdomain>.<rootDomain>`). MUST match the publish-side
 * `pageRootDomain()` (convex/pages.ts) so the eviction targets the SAME host the
 * publish registered the route under. Env override (`PAGES_ROOT_DOMAIN`) lets a
 * different deployment retarget; the hardcoded fallback mirrors `pageRootDomain`.
 */
export function rootDomain(): string {
  return process.env.PAGES_ROOT_DOMAIN ?? "shortwind.dev";
}

/**
 * The canonical KV key for a route. MUST match `worker/src/kv.ts`
 * `routeKey(host, path)`: host lowercased, path normalized to a leading slash,
 * prefixed `route:`. The serve Worker writes routes under
 * `route:{host}/{slug}` (path = `url.pathname` = `/<slug>`), so eviction targets
 * the same key.
 */
export function routeKey(host: string, path: string): string {
  const h = host.toLowerCase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `route:${h}${p}`;
}

/**
 * The route key for a page slug under the serve host. The serve path treats the
 * request path as the slug (`/hello` → slug `hello`), so the route key is
 * `route:{serveHost}/{slug}`.
 */
export function routeKeyForSlug(slug: string, host: string = serveHost()): string {
  return routeKey(host, `/${slug}`);
}

/**
 * CLOUD-SUBDOMAIN: the route key for a page's per-page SUBDOMAIN serve. The serve
 * Worker resolves `<subdomain>.<root>/` (host = the subdomain host, path = `/`),
 * so the KV route key is `route:{subdomain}.{root}/`. MUST stay byte-identical to
 * how worker/src/kv.ts `routeKey(host, path)` keys a subdomain request (host
 * lowercased, path `/`) — both are golden-tested.
 */
export function routeKeyForSubdomain(
  subdomain: string,
  root: string = rootDomain(),
): string {
  return routeKey(`${subdomain}.${root}`, "/");
}

/**
 * DELETE a single KV key via the Cloudflare KV REST API. Fail-safe: returns
 * `true` on a 2xx (or a 404 — an already-absent key is a successful eviction),
 * `false` on any error WITHOUT throwing. The caller logs + continues so a KV
 * failure never breaks the DB-level kill.
 *
 * Env (set on the Convex deployment):
 *   - `CLOUDFLARE_ACCOUNT_ID` — the account the KV namespace lives under.
 *   - `CLOUDFLARE_API_TOKEN`  — a token with KV write (Workers KV Storage Edit).
 *   - `KV_NAMESPACE_ID`       — the ROUTES namespace id (matches wrangler.toml).
 *
 * Absent creds ⇒ skip (return false): keeps the kill path working in dev/test
 * without Cloudflare creds, exactly as the prior no-op port did.
 */
export async function evictKvRouteByKey(key: string): Promise<boolean> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const namespaceId = process.env.KV_NAMESPACE_ID;

  if (!accountId || !apiToken || !namespaceId) {
    // Un-provisioned (dev/test): nothing to evict against. Not an error.
    return false;
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}` +
    `/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    // A 404 means the key was already gone — still a successful eviction.
    if (res.ok || res.status === 404) return true;
    const detail = await res.text().catch(() => "");
    console.error(
      `[edge_kv] KV route eviction failed (${res.status}) for ${key}: ${detail.slice(0, 200)}`,
    );
    return false;
  } catch (err) {
    // Network / unexpected error: log + swallow. The DB tombstone/quarantine is
    // the source of truth; a missed eviction degrades to stale-until-TTL, not a
    // broken kill.
    console.error(`[edge_kv] KV route eviction threw for ${key}:`, err);
    return false;
  }
}

/**
 * Evict the KV route for a page slug (the lifecycle/kill seam's one job). Derives
 * the route key from the serve host + slug and deletes it. Fail-safe — never
 * throws; logs on failure.
 *
 * IMPORTANT: this does a `fetch`, so it can ONLY run inside a Convex ACTION (a
 * mutation/query forbids `fetch`). The lifecycle/kill paths are MUTATIONS, so
 * they do NOT call this directly — they SCHEDULE {@link evictRouteAction} via
 * `scheduleRouteEviction` (`ctx.scheduler.runAfter(0, ...)`), which runs this in
 * an action moments after the mutation commits. This module is also imported by
 * the offline unit tests, which call this directly inside `t.run` (no real
 * fetch creds ⇒ a no-op return) to exercise the route-key derivation.
 */
export async function evictRouteForSlug(slug: string): Promise<void> {
  await evictKvRouteByKey(routeKeyForSlug(slug));
}

/**
 * CLOUD-SUBDOMAIN: evict EVERY KV route key a page may be served under — the
 * legacy path-based key (`route:{serveHost}/{slug}`) AND, when the page has a
 * subdomain, the per-page subdomain key (`route:{subdomain}.{root}/`). A killed/
 * deleted/expired page must stop serving on BOTH the path host and its subdomain.
 * Fail-safe per key — never throws (see {@link evictKvRouteByKey}).
 */
export async function evictRouteForPage(
  slug: string,
  subdomain?: string | null,
): Promise<void> {
  await evictKvRouteByKey(routeKeyForSlug(slug));
  if (subdomain) {
    await evictKvRouteByKey(routeKeyForSubdomain(subdomain));
  }
}

/**
 * The internalAction that actually performs the KV REST eviction. Scheduled (not
 * called inline) by the kill/delete/expiry mutations so the `fetch` runs in an
 * action context. Fail-safe: `evictRouteForSlug` swallows + logs any error, so a
 * Cloudflare failure never surfaces as a failed scheduled job that retries
 * forever — the DB tombstone/quarantine is already the source of truth.
 */
export const evictRouteAction = internalAction({
  args: {
    slug: v.string(),
    // CLOUD-SUBDOMAIN: evict the per-page subdomain route key too when present.
    subdomain: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await evictRouteForPage(args.slug, args.subdomain ?? null);
    return null;
  },
});

/**
 * The slice of a mutation `ctx` we need to schedule the eviction: just the
 * scheduler. Declared structurally so we don't pull a Convex ctx type into the
 * port signatures (and so the offline test ports — which pass no scheduler —
 * still satisfy the interface).
 */
export interface SchedulerCtx {
  // `runAfter` is intentionally loose (`any` ref/args): the real Convex mutation
  // ctx's generic `runAfter` signature must be assignable to this, and a precise
  // FunctionReference type would require importing Convex's server generics here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: { runAfter: (delayMs: number, ref: any, args: any) => Promise<any> };
}

/**
 * Schedule the KV route eviction to run in an action right after the current
 * mutation commits. The kill/delete/expiry mutations call THIS (not
 * `evictRouteForSlug`) because a mutation cannot `fetch`. Fail-safe: scheduling
 * is a DB-transaction op (no network), so it cannot fail on the Cloudflare side;
 * if the deployment lacks the scheduler (offline tests pass a bare port) the
 * caller simply doesn't reach here.
 */
export async function scheduleRouteEviction(
  ctx: SchedulerCtx,
  slug: string,
  subdomain?: string | null,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.lib.edge_kv.evictRouteAction, {
    slug,
    // CLOUD-SUBDOMAIN: thread the subdomain so the action evicts that key too.
    subdomain: subdomain ?? null,
  });
}
