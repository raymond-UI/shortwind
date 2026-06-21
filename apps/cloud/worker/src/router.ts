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
  type CachedRoute,
  type ColdRouteSource,
} from "./kv.js";
import { getArtifact } from "./r2.js";
import { cacheArtifactResponse } from "./cache.js";

/**
 * Validates a bearer token against a private route. Injected so the router has
 * no Convex dependency (tests pass a stub; CLOUD-30 wires the live check).
 * Returns `true` iff the token is valid AND authorized to read this page.
 */
export type TokenValidator = (
  token: string,
  route: CachedRoute,
) => Promise<boolean>;

/** The two cold-source functions the router injects (see module header). */
export interface RouterDeps {
  /** Resolve a route from the cold source (Convex) on a KV miss. */
  coldRoute: ColdRouteSource;
  /** Validate a bearer token for a private page (Convex check). */
  validateToken: TokenValidator;
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

  // 1. Resolve host/path → route. KV hot, Convex cold (injected). A KV hit does
  //    NOT call the cold source (asserted by tests + kv.ts contract).
  const route = await resolveRouteWithFallback(env, host, path, deps.coldRoute);
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

  // Cache at the edge so a viral page costs ~nothing (PRD §6.1, §6.4). Use the
  // request URL as the cache key (mirrors invalidateRoute's per-URL key). Clone
  // so the body the client receives is independent of the cached copy. Do the
  // put in the background via waitUntil — never block the response on it.
  const edge = (caches as unknown as { default: Cache }).default;
  ctx.waitUntil(edge.put(request.url, response.clone()));

  return response;
}

/**
 * Default cold-source deps for an un-provisioned worker.
 *
 * Until CLOUD-30 wires the live Convex query + token check, the worker resolves
 * NOTHING from cold (every KV miss → 404) and trusts NO token (every private
 * page → 401). Closed-by-default: a worker without its Convex wiring cannot
 * accidentally serve private content or invent routes. The live URL/credentials
 * live in env placeholders (see wrangler.toml) and replace these in CLOUD-30.
 */
function defaultDeps(_env: Env): RouterDeps {
  return {
    coldRoute: async () => null,
    validateToken: async () => false,
  };
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
