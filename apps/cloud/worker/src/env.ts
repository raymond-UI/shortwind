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
}
