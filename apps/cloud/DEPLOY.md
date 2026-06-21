# Shortwind Cloud — deploy runbook (CLOUD-30b)

The full Phase 0–3 codebase is built, reviewed, and merged on `feat/shortwind-cloud`
(tsc clean; 398 tests green). This is the live-deploy sequence. Everything below
needs the credentials documented in `.env.example`.

## 0. Prerequisites
- A valid **Cloudflare API token** with: Workers Scripts *Edit*, Workers R2 *Edit*,
  Workers KV *Edit*, and (for bind-domain) SSL/Certificates *Edit* + Custom Hostnames.
  > The token supplied during the build failed `/user/tokens/verify` — re-issue it.
- A **Convex** project + deploy key (`CONVEX_DEPLOY_KEY`).
- `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).

Fill `apps/cloud/.env` from `.env.example`, then `set -a && . ./.env && set +a`.

## 1. Provision Cloudflare resources
```bash
cd apps/cloud
wrangler r2 bucket create shortwind-artifacts
wrangler kv namespace create ROUTES          # note the returned id
```
Edit `worker/wrangler.toml`: set `[[r2_buckets]].bucket_name = "shortwind-artifacts"`,
`[[kv_namespaces]].id = "<id>"`, and `[vars].CONVEX_HTTP_URL = "<convex https origin>"`.

## 2. Deploy Convex (control plane)
```bash
npx convex deploy           # regenerates convex/_generated against the live deployment,
                            # registers the Better Auth + rate-limiter components,
                            # and replaces the hand-authored api.d.ts stubs.
```
Set the Convex env vars in the dashboard: `BETTER_AUTH_SECRET`, `SITE_URL`,
`R2_S3_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (the publish action's
R2 writer), and the known-CSAM hash-list / domain-reputation sources.

## 3. Wire the live ports (the deploy-time seams every issue documented)
These are injected at deploy; the offline build left them as closed-by-default no-ops:
- **R2 writer** (`convex/pages.ts` `writeArtifactToR2`) → S3 client from `R2_*`.
- **Edge invalidation + KV route put/delete** (the `LifecycleEdgePort` / `KillEdgePort` /
  router `putRoute`) → real Cloudflare Cache purge + `ROUTES` KV writes.
  **Critical (PRD §8):** until this is wired, the CSAM/abuse kill path evicts the DB
  row but not the edge — a killed page can serve from cache until TTL. Must be live
  before any public launch.
- **Worker cold source** (`router.ts` `coldRoute` / `validateToken` / `coldCustomHostname`)
  → live Convex queries via `CONVEX_HTTP_URL`.
- **Cloudflare for SaaS client** (`convex/domains.ts` `CloudflareSaaSClient`) → real
  custom-hostnames API (Phase 2 bind-domain).
- **Real CSAM hash list + domain-reputation** (`convex/lib/content-scan.ts` `__setScanSources`).

## 4. Deploy the Worker (serve path) + dashboard
```bash
wrangler deploy                              # apps/cloud (serve router)
cd dashboard && VITE_CONVEX_URL=... VITE_BETTER_AUTH_URL=... pnpm build   # then host the static dist
```

## 5. Smoke test (end-to-end)
```bash
# from any directory — the global home is machine-wide, no per-repo setup:
shortwind-cloud login                        # device flow → token in ~/.shortwind/
shortwind-cloud init --global
shortwind-cloud publish ./page.html --visibility public   # → { url, version }
curl -s <url>                                # served from R2 via the edge
shortwind-cloud find --q page                # stateless re-discovery
```
Expected: publish expands server-side, writes the frozen artifact to R2, returns a
durable URL; the Worker streams it; `find` lists it. Then verify the kill path:
`POST /v1/abuse` → operator `killPage` → the URL stops serving immediately (edge evicted).

## Notes
- GitHub issues #99–#124 carry `Closes #…` and auto-close when `feat/shortwind-cloud`
  merges to `main` (they stay open while the work lives on the feature branch).
- Convex `_generated/api.d.ts` is hand-authored in the repo for offline typechecking;
  `convex deploy` / `convex dev` regenerates it authoritatively — expected, not drift.
