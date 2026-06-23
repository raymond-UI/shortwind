# Shortwind Cloud — deploy runbook (CLOUD-30b)

The full Phase 0–3 codebase is built, reviewed, and merged on `feat/shortwind-cloud`
(tsc clean; 398 tests green). This is the live-deploy sequence. Everything below
needs the credentials documented in `.env.example`.

## 0. Prerequisites
- A valid **Cloudflare API token** with: Workers Scripts *Edit*, Workers R2 *Edit*,
  Workers KV *Edit*, and (for bind-domain) SSL/Certificates *Edit* + Custom Hostnames.
  > CI uses an **account-owned** token (CF's recommended CI credential). These are
  > account-scoped and do NOT expose zone-level permissions (`Workers Routes`,
  > `Zone`), so the `*.shortwind.app` route is attached manually (see §1) — the
  > token can still upload the Worker + bind KV/R2. A **user** token can carry the
  > zone perms if you'd rather manage routes from `wrangler.toml`.
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

### User-content apex — `shortwind.app` (audit #3)
Published pages serve from the DEDICATED apex `shortwind.app`, separate from the
dashboard/marketing apex `shortwind.dev`, so untrusted page JS shares no cookie or
origin trust with the platform. To provision:
1. Add the `shortwind.app` zone to the Cloudflare account; add a **proxied wildcard
   DNS** record `*.shortwind.app` (e.g. AAAA `*` → `100::`).
2. Attach the serve Worker route `*.shortwind.app/*` **manually, once**:
   Cloudflare dash → Workers & Pages → `shortwind-cloud-serve` → Settings →
   Domains & Routes → Add → Route → `*.shortwind.app/*`, zone `shortwind.app`.
   It is NOT in `wrangler.toml` on purpose: CI deploys with an **account-owned**
   API token, which is account-scoped and has no zone-level `Workers Routes`
   permission — declaring the route would make `wrangler deploy` fail (auth error
   10000). With no `routes` key, wrangler leaves the manual route untouched on
   every deploy. (To automate it instead, use a **user** API token with
   `Workers Routes:Edit` + `Zone:Read` and uncomment the `routes` block.)
3. **Remove the old `*.shortwind.dev` wildcard route** that pointed at the serve
   Worker — user content must stop serving on `shortwind.dev`. (The router 301s any
   leftover `*.shortwind.dev` host to `https://shortwind.dev` as a backstop.)
4. Set the publish-path Convex env vars so generated URLs match:
   ```bash
   npx convex env set PAGES_ROOT_DOMAIN shortwind.app --prod
   npx convex env set PAGES_BASE_URL https://shortwind.app --prod
   ```
5. Follow-up for cross-page isolation: submit `shortwind.app` to the **Public
   Suffix List** (like `vercel.app`) so each `*.shortwind.app` subdomain is its own
   eTLD+1 and pages can't set cookies readable across each other.

### Platform API origin — `api.shortwind.dev` (branded, vendor-independent)
The CLI and OAuth clients talk to ONE stable origin, `api.shortwind.dev`, served by
the **api-proxy Worker** (`apps/cloud/api-proxy`). It reverse-proxies the public
Convex HTTP surface (`/v1`, `/oauth`, `/.well-known`) and 404s everything else — the
Worker-only `/internal/*` cold-source endpoints are deliberately NOT reachable from
this origin.

Why a proxy and not the raw `*.convex.site` slug: the Convex deployment name is an
immutable vendor identifier. Exposing it as the public origin would bake it into the
OAuth `issuer`, the discovery doc, the REST catalog, AND the shipped CLI default —
locking the platform to one deployment forever. The proxy makes `api.shortwind.dev`
the stable identity; the slug is just `CONVEX_HTTP_URL` in `api-proxy/wrangler.toml`,
swappable to migrate deployments without a client release.

**Rollout order matters** — bring the origin up BEFORE flipping `SITE_URL`, or
discovery will advertise a dead origin:
1. Deploy the Worker (CI does this on merge, or `cd api-proxy && wrangler deploy`).
2. **DNS + route, attached manually once** (account-owned token can't attach zone
   routes — same limitation as the serve Worker). Easiest is a **Custom Domain**,
   which creates the DNS record + route together:
   Cloudflare dash → Workers & Pages → `shortwind-cloud-api` → Settings → Domains &
   Routes → Add → **Custom Domain** → `api.shortwind.dev`.
   (Or add a proxied DNS record for `api` in the `shortwind.dev` zone + a Route
   `api.shortwind.dev/*`.)
3. Verify it proxies (still advertises the slug at this point — fine):
   `curl -s https://api.shortwind.dev/.well-known/oauth-authorization-server`
4. **Flip the issuer** so discovery, the catalog, the `issuer`, and the CLI default
   all converge on the branded origin:
   ```bash
   npx convex env set SITE_URL https://api.shortwind.dev --prod
   ```
   Re-check the curl above — `issuer` + endpoints now read `api.shortwind.dev`.
5. The CLI default is already `https://api.shortwind.dev` (api-client.ts). No
   `SHORTWIND_CLOUD_API` override is needed in normal use; it remains for dev/staging.

## 2. Deploy Convex (control plane)
```bash
npx convex deploy           # regenerates convex/_generated against the live deployment,
                            # registers the Better Auth + rate-limiter components,
                            # and replaces the hand-authored api.d.ts stubs.
```
Set the Convex env vars in the dashboard: `BETTER_AUTH_SECRET`, `SITE_URL`,
`R2_S3_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (the publish action's
R2 writer), and the known-CSAM hash-list / domain-reputation sources.

**Security (audit #7) — `SERVE_INTERNAL_SECRET`:** generate a random secret and set
it as a Convex env var AND as a Worker secret with the SAME value:
```bash
SECRET=$(openssl rand -hex 32)
npx convex env set SERVE_INTERNAL_SECRET "$SECRET" --prod
wrangler secret put SERVE_INTERNAL_SECRET   # paste the same value
```
This gates the Worker-only `/internal/resolve` + `/internal/validate-token`
cold-source endpoints (which expose `artifactKey`/`accountId` for private/
quarantined pages) so only the serve Worker — which presents the matching
`x-serve-secret` header — can call them. Leave it unset only for local/dev.

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
shortwind cloud login                        # device flow → token in ~/.shortwind/
shortwind cloud init-global
shortwind cloud publish ./page.html --visibility public   # → { url, version }
curl -s <url>                                # served from R2 via the edge
shortwind cloud find --q page                # stateless re-discovery
```
Expected: publish expands server-side, writes the frozen artifact to R2, returns a
durable URL; the Worker streams it; `find` lists it. Then verify the kill path:
`POST /v1/abuse` → operator `killPage` → the URL stops serving immediately (edge evicted).

## Notes
- GitHub issues #99–#124 carry `Closes #…` and auto-close when `feat/shortwind-cloud`
  merges to `main` (they stay open while the work lives on the feature branch).
- Convex `_generated/api.d.ts` is hand-authored in the repo for offline typechecking;
  `convex deploy` / `convex dev` regenerates it authoritatively — expected, not drift.
