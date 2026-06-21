/**
 * Typed Worker environment bindings for the Shortwind Cloud serve path.
 *
 * CLOUD-21 owns this surface; the CLOUD-22 serve router and the publish/update/
 * delete mutations re-import `Env` from here so there is a single source of
 * truth for the bindings the hot path touches.
 *
 * The two storage bindings:
 *  - `ARTIFACTS`  — R2 bucket holding the frozen Tailwind HTML artifacts. Zero
 *    egress; the router streams an object body straight to the response (PRD
 *    §6.1). Keyed by `PageVersion.artifactKey` (see ./r2.ts).
 *  - `ROUTES`     — KV namespace caching hostname/path → page route records, so
 *    the hot path resolves a request without hitting Convex. Convex is the cold
 *    source on a KV miss (PRD §6.1, §6.3); see ./kv.ts.
 *
 * Live R2/KV ids are wired at CLOUD-30 (see worker/wrangler.toml placeholders);
 * tests run entirely against local miniflare bindings.
 */
export interface Env {
  /** R2 bucket of frozen page artifacts. Binding name: `ARTIFACTS`. */
  ARTIFACTS: R2Bucket;
  /** KV namespace: hostname/path → route record hot cache. Binding: `ROUTES`. */
  ROUTES: KVNamespace;
  /**
   * CLOUD-30b: the live Convex HTTP origin (e.g. `https://rare-toad-197.convex.site`),
   * injected as a `[vars]` value in `wrangler.toml`. The router's cold source
   * fetches the route resolver (`/internal/resolve`) and the private-token
   * validator (`/internal/validate-token`) under this origin on a KV miss. An
   * empty string keeps the worker closed-by-default (cold miss → 404, token → 401).
   */
  CONVEX_HTTP_URL: string;
}
