/**
 * Typed bindings for the Shortwind Cloud API-proxy Worker.
 *
 * This Worker is the platform's STABLE, BRANDED public API origin
 * (`api.shortwind.dev`). It is a thin reverse proxy in front of the Convex HTTP
 * actions deployment — its whole reason to exist is a layer of indirection so the
 * public origin (and therefore the OAuth `issuer` + every advertised endpoint) is
 * a name WE own, not the immutable Convex deployment slug. Re-pointing to a new
 * Convex deployment (DR, a new prod, self-hosted Convex, leaving Convex) is then
 * a one-line `CONVEX_HTTP_URL` change here — no CLI release, no issuer churn.
 */
export interface Env {
  /**
   * The live Convex HTTP-actions origin to forward to, e.g.
   * `https://prestigious-shrimp-154.convex.site`. Injected as a `[vars]` value in
   * `wrangler.toml`. This slug lives ONLY here — it never ships in the CLI binary
   * nor appears in any public contract. Empty string → closed-by-default (502),
   * so an un-provisioned deploy can't silently forward to nowhere.
   */
  CONVEX_HTTP_URL: string;
}
