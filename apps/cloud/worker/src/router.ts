/**
 * CLOUD-22 — Worker serve router (the hot path).
 *
 * A *pure router* (PRD §6.1): it resolves a request to a frozen artifact and
 * streams it. It NEVER expands recipes and NEVER writes to the DB on the serve
 * path. The only IO is:
 *   - read the ROUTES KV cache (Convex is the cold source on a miss), and
 *   - read (stream) the R2 artifact object,
 *   - conditionally validate a bearer token (private pages only) via the cold
 *     source / a Convex check.
 *
 * Expansion happens server-side at publish (the Convex action, CLOUD-20); the
 * frozen artifact in R2 is already a complete self-contained document (CLOUD-23
 * assembles it with the @tailwindcss/browser compile script). `expand-edge.ts`
 * (the CLOUD-02 spike) is deliberately NOT imported here.
 *
 * Dependency injection
 * --------------------
 * The router's two cold-source calls are injected as plain async functions
 * (`RouterDeps`) so tests pass stubs and so this module keeps zero Convex
 * dependency (mirrors `kv.ts`'s `ColdRouteSource` design):
 *
 *   - `coldRoute(host, path)`  → resolve a route from Convex on a KV miss.
 *   - `validateToken(token, route)` → true if `token` is a valid scoped token
 *     authorized to read this private page.
 *
 * CLOUD-30 wires the LIVE implementations (a fetch to a Convex HTTP route, or
 * the Convex client) from the env placeholders below; until then `fetch`'s
 * default deps reject every cold resolution and every token, which is the safe
 * closed-by-default posture for an un-provisioned worker.
 *
 * Status-code matrix (lifecycle/visibility enforced BEFORE serving):
 *   route not found                         → 404
 *   lifecycle === 'tombstoned'              → 410 Gone            (soft-deleted, §8.2)
 *   lifecycle === 'quarantined'             → 451 (takedown/seal, §8.2)
 *   visibility === 'public'                 → 200, no auth
 *   visibility === 'unlisted'               → 200, no auth, X-Robots-Tag: noindex
 *   visibility === 'private', no/invalid tok→ 401
 *   visibility === 'private', valid tok     → 200
 *   R2 object missing                       → 404
 */
import type { Env } from "./env.js";
import {
  resolveRouteWithFallback,
  putRoute,
  type CachedRoute,
  type ColdRouteSource,
} from "./kv.js";
import { getArtifact } from "./r2.js";
import { cacheArtifactResponse, edgeCacheKey } from "./cache.js";

/**
 * Validates a bearer token against a private route. Injected so the router has
 * no Convex dependency (tests pass a stub; CLOUD-30 wires the live check).
 * Returns `true` iff the token is valid AND authorized to read this page.
 */
export type TokenValidator = (
  token: string,
  route: CachedRoute,
) => Promise<boolean>;

/**
 * Resolve an incoming CUSTOM HOSTNAME (a bound `pages.customDomain`) to its page
 * route (CLOUD-40). Injected like {@link ColdRouteSource} so the router keeps
 * zero Convex dependency; the live impl reads `by_customDomain` from the cold
 * source (Convex) and is wired at deploy (CLOUD-30b). Returns `null` when no page
 * binds the hostname.
 */
export type ColdCustomHostnameSource = (
  host: string,
) => Promise<CachedRoute | null>;

/** The cold-source functions the router injects (see module header). */
export interface RouterDeps {
  /** Resolve a route from the cold source (Convex) on a KV miss. */
  coldRoute: ColdRouteSource;
  /** Validate a bearer token for a private page (Convex check). */
  validateToken: TokenValidator;
  /**
   * Resolve a bound custom hostname → its page route (CLOUD-40). Optional: when
   * absent, the custom-hostname branch is skipped and the router behaves exactly
   * as before (host/path resolution only).
   */
  coldCustomHostname?: ColdCustomHostnameSource;
}

/**
 * The dedicated user-content apex pages serve under as subdomains
 * (`<label>.shortwind.app`). SECURITY (audit #3): this is a SEPARATE registrable
 * domain from the platform apex {@link PLATFORM_DOMAIN}, so untrusted page JS
 * shares no cookie/origin trust with the dashboard/marketing site.
 */
const USER_CONTENT_DOMAIN = "shortwind.app";

/**
 * The platform marketing + dashboard apex. NO user content serves here anymore
 * (audit #3). Any subdomain that still reaches this Worker (legacy
 * `*.shortwind.dev` — including the retired `c.shortwind.dev`) is retired with a
 * 301 to the marketing site.
 */
const PLATFORM_DOMAIN = "shortwind.dev";

/** Where reserved/retired hosts redirect (the marketing site). */
const MARKETING_URL = `https://${PLATFORM_DOMAIN}`;

/**
 * Reserved/system subdomain labels under {@link USER_CONTENT_DOMAIN} that are NOT
 * pages. Mirrors `shared/src/slug.ts` `RESERVED_SUBDOMAINS` (the worker can't
 * import it — it types against @cloudflare/workers-types via ./env, which the
 * shared package's tsconfig doesn't load; an equality test guards the drift). A
 * genuine unknown PAGE label (a typo'd slug) is NOT in this set and still 404s.
 */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  "c",
  "www",
  "api",
  "app",
  "dashboard",
  "cloud",
]);

/**
 * Decide whether `host` should be redirected instead of served:
 *   - ANY host under the platform apex `shortwind.dev` (a retired serve host:
 *     `c.shortwind.dev`, `www.shortwind.dev`, or a legacy page subdomain) → 301
 *     to the marketing site. User content no longer serves on `shortwind.dev`.
 *   - The bare user-content apex (`shortwind.app`) or a reserved/system label
 *     under it (`www.shortwind.app`, …) → 301 to the marketing site.
 *   - A genuine page subdomain under `shortwind.app` (or any bound custom domain)
 *     → `null`, so it resolves / 404s normally.
 */
function reservedHostRedirect(host: string): Response | null {
  const h = host.toLowerCase().replace(/\.$/, "");

  // Retired platform apex: nothing under shortwind.dev serves user content now.
  if (h === PLATFORM_DOMAIN || h.endsWith(`.${PLATFORM_DOMAIN}`)) {
    return Response.redirect(MARKETING_URL, 301);
  }

  // User-content apex: the bare apex and reserved/system labels are not pages.
  const suffix = `.${USER_CONTENT_DOMAIN}`;
  if (h === USER_CONTENT_DOMAIN) return Response.redirect(MARKETING_URL, 301);
  if (!h.endsWith(suffix)) return null; // a bound custom domain → resolve normally
  const label = h.slice(0, -suffix.length);
  // Exactly one label in front of the apex, and it is a reserved/system label.
  if (label === "" || label.includes(".")) return null;
  if (!RESERVED_LABELS.has(label)) return null;
  return Response.redirect(MARKETING_URL, 301);
}

/** Minimal text/html response with no body — used for refusals (4xx/410/451). */
function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Pull the bearer token out of the Authorization header, or null. */
function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth === null) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1] : null;
}

/**
 * The router core. Separated from the `fetch` export so tests drive it with
 * injected deps and a real `ctx`. Reads KV/R2 only; never expands, never writes
 * to the DB (PRD §6.1).
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: RouterDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const host = url.hostname;
  const path = url.pathname;

  // 0. Reserved/retired host → 301 to the apex (BEFORE page resolution). The
  //    retired legacy serve host `c.shortwind.dev` (custom domain removed, still
  //    resolved by the wildcard) and other system labels (`www`, …) redirect to
  //    https://shortwind.dev instead of returning a confusing 404. A genuine
  //    unknown PAGE subdomain (a typo'd slug) is not reserved and falls through to
  //    normal resolution → 404.
  const redirect = reservedHostRedirect(host);
  if (redirect !== null) return redirect;

  // 1. Resolve host/path → route. KV hot, Convex cold (injected). A KV hit does
  //    NOT call the cold source (asserted by tests + kv.ts contract).
  let route = await resolveRouteWithFallback(env, host, path, deps.coldRoute);

  // 1b. CLOUD-40 (ADDITIVE): a custom hostname bound to a page (pages.customDomain)
  //     resolves here. Tried ONLY on a host/path miss, so the existing hot-path
  //     resolution + KV-hit discipline above is untouched: a normal route never
  //     reaches this branch. The bound page serves at the hostname root; a deeper
  //     path under a custom hostname is not a separate route and falls through to
  //     404 below. The result is cached under (host, path) like any cold hit so a
  //     repeat view is a KV hit (no Convex call). When no resolver is injected the
  //     branch is skipped and behavior is identical to before.
  if (route === null && deps.coldCustomHostname !== undefined) {
    const custom = await deps.coldCustomHostname(host);
    if (custom !== null) {
      await putRoute(env, host, path, custom);
      route = custom;
    }
  }

  if (route === null) return refuse(404, "Not Found");

  // 2. Enforce lifecycle BEFORE serving (§8.2 takedown states).
  if (route.lifecycle === "tombstoned") {
    return refuse(410, "Gone");
  }
  if (route.lifecycle === "quarantined") {
    // 451: sealed for legal/abuse takedown (PRD §8.2 quarantine state). Chosen
    // over 404 so the takedown is explicit and auditable rather than masquerading
    // as a missing page.
    return refuse(451, "Unavailable For Legal Reasons");
  }

  // 3. Enforce visibility BEFORE serving.
  //    public   → serve, no auth.
  //    unlisted → serve, no auth, but mark noindex (excluded from discovery).
  //    private  → require a valid bearer token (cold-source / Convex check).
  let noindex = false;
  if (route.visibility === "unlisted") {
    noindex = true;
  } else if (route.visibility === "private") {
    const token = bearer(request);
    if (token === null) return refuse(401, "Unauthorized");
    const ok = await deps.validateToken(token, route);
    if (!ok) return refuse(401, "Unauthorized");
  }

  // 4. Stream the frozen artifact from R2. Missing object → 404.
  const artifact = await getArtifact(env, route.artifactKey);
  if (artifact === null) return refuse(404, "Not Found");

  // The artifact is already a complete self-contained document; the router just
  // streams it with content-type text/html + etag (shaped by cacheArtifactResponse).
  const response = cacheArtifactResponse(artifact);
  if (noindex) {
    response.headers.set("x-robots-tag", "noindex");
  }

  // Only PUBLIC pages are cacheable (audit). A private page is gated on a per-
  // request bearer, and an unlisted page must stay out of any shared cache; both
  // get `private, no-store` and are NEVER written to the shared edge cache (a
  // cached private artifact would serve to a later request that presents no/another
  // token). Public pages cache at the edge so a viral page costs ~nothing
  // (PRD §6.1, §6.4), keyed by the normalized `(host, pathname)` key (audit #4 —
  // query stripped so `?x=N` variants can't poison/flood the cache).
  if (route.visibility === "public") {
    const edge = (caches as unknown as { default: Cache }).default;
    // Clone so the body the client receives is independent of the cached copy.
    ctx.waitUntil(edge.put(edgeCacheKey(request.url), response.clone()));
  } else {
    response.headers.set("cache-control", "private, no-store");
  }

  return response;
}

/**
 * The route projection the Convex `/internal/resolve` endpoint returns. It is a
 * `CachedRoute` (the Worker JSON-parses it straight into one) or `null`. Declared
 * locally so the router keeps zero Convex dependency (CLAUDE.md).
 */
type ResolvedRoute = CachedRoute | null;

/** Narrow an unknown JSON value to a CachedRoute (defensive against a malformed
 * cold-source response — anything off-shape resolves to a 404, never a serve). */
function asCachedRoute(value: unknown): CachedRoute | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.pageId === "string" &&
    typeof r.accountId === "string" &&
    typeof r.version === "number" &&
    typeof r.artifactKey === "string" &&
    (r.lifecycle === "active" ||
      r.lifecycle === "quarantined" ||
      r.lifecycle === "tombstoned") &&
    (r.visibility === "public" ||
      r.visibility === "unlisted" ||
      r.visibility === "private")
  ) {
    return value as unknown as CachedRoute;
  }
  return null;
}

/**
 * Live cold-source deps for a provisioned worker (CLOUD-30b).
 *
 * When `env.CONVEX_HTTP_URL` is set, the worker resolves a KV miss against the
 * Convex system of record and validates private-page bearers there:
 *   - `coldRoute(host, path)`  → GET `${CONVEX_HTTP_URL}/internal/resolve`
 *   - `validateToken(tok,rte)` → GET `${CONVEX_HTTP_URL}/internal/validate-token`
 *
 * Closed-by-default fallback: when `CONVEX_HTTP_URL` is EMPTY (an un-provisioned
 * worker) the worker resolves NOTHING from cold (every KV miss → 404) and trusts
 * NO token (every private page → 401), so it can never accidentally serve private
 * content or invent routes. A cold-source error (network/5xx) also resolves to
 * "no route" / "token invalid" — fail closed, never fail open.
 *
 * The hot-path discipline is preserved: these are only ever invoked by
 * `resolveRouteWithFallback` on a KV MISS (a KV hit never calls cold), and a cold
 * hit is written back to KV by that helper, so a repeat view is a pure KV serve.
 */
function defaultDeps(env: Env): RouterDeps {
  const base = (env.CONVEX_HTTP_URL ?? "").replace(/\/+$/, "");
  if (base === "") {
    // Un-provisioned: closed-by-default.
    return {
      coldRoute: async () => null,
      validateToken: async () => false,
    };
  }

  // Audit #7: present the shared secret on every cold-source call so Convex's
  // `/internal/*` endpoints can reject anyone who is not this Worker.
  const secret = env.SERVE_INTERNAL_SECRET;
  const secretHeader: Record<string, string> = secret
    ? { "x-serve-secret": secret }
    : {};
  const internalInit: RequestInit | undefined = secret
    ? { headers: secretHeader }
    : undefined;

  const coldRoute: ColdRouteSource = async (host, path) => {
    try {
      const url = `${base}/internal/resolve?host=${encodeURIComponent(
        host,
      )}&path=${encodeURIComponent(path)}`;
      const res = await fetch(url, internalInit);
      if (!res.ok) return null;
      const body = (await res.json()) as ResolvedRoute;
      return asCachedRoute(body);
    } catch {
      // Fail closed: a cold-source error must not serve or invent a route.
      return null;
    }
  };

  const validateToken: TokenValidator = async (token, route) => {
    try {
      // Audit #5: send the bearer in the Authorization HEADER, never the URL
      // query — a `?bearer=` token leaks into CF/Convex access logs + Referer.
      const url = `${base}/internal/validate-token?pageId=${encodeURIComponent(
        route.pageId,
      )}`;
      const res = await fetch(url, {
        headers: { ...secretHeader, authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: unknown };
      return body.ok === true;
    } catch {
      // Fail closed: a validation error denies access.
      return false;
    }
  };

  // Audit (serve WARNING): wire the custom-hostname cold source so a bound
  // `pages.customDomain` actually resolves in prod (it was a dead branch —
  // defaultDeps omitted it). Tried only on a host/path miss (see handleRequest).
  const coldCustomHostname: ColdCustomHostnameSource = async (host) => {
    try {
      const url = `${base}/internal/resolve-custom?host=${encodeURIComponent(
        host,
      )}`;
      const res = await fetch(url, internalInit);
      if (!res.ok) return null;
      const body = (await res.json()) as ResolvedRoute;
      return asCachedRoute(body);
    } catch {
      return null;
    }
  };

  return { coldRoute, validateToken, coldCustomHostname };
}

/**
 * The Worker entrypoint. `wrangler.toml` `main` points here. It builds the live
 * deps from `env` (CLOUD-30) and delegates to `handleRequest`.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handleRequest(request, env, ctx, defaultDeps(env));
  },
};
