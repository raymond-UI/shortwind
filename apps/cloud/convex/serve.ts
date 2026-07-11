import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRead } from "./lib/auth_guard.js";
import { isReservedSubdomain } from "../shared/src/slug.js";
import { normalizeBundlePath, normalizeServePath } from "./lib/bundle_path.js";

/**
 * CLOUD-30b — the Worker serve-path COLD SOURCE (PRD §6.1, §6.3).
 *
 * The serve Worker (worker/src/router.ts) resolves a request to a frozen R2
 * artifact KV-first; on a KV miss it falls back HERE, the Convex system of
 * record, via two public HTTP routes (convex/http.ts):
 *
 *   GET  /internal/resolve?host=&path=     → api.serve.resolveRoute
 *   GET  /internal/validate-token?...      → api.serve.validateRouteToken
 *
 * Both are PUBLIC Convex queries (a query can read ctx.db). `resolveRoute` needs
 * NO auth — it returns exactly the {@link ServeRoute} the Worker needs to serve
 * or refuse (pageId/accountId/version/artifactKey/lifecycle/visibility), and the
 * Worker enforces visibility/lifecycle itself. `validateRouteToken` re-uses the
 * standard {@link requireRead} guard to validate a bearer for a PRIVATE page.
 *
 * Route resolution (CLOUD-SUBDOMAIN) is SUBDOMAIN-ONLY: a request resolves to a
 * page solely by its per-page subdomain (`<label>.shortwind.dev` → the page whose
 * `subdomain === label`, via the global `by_subdomain` index). The request path is
 * irrelevant. There is no path-as-slug fallback — a host that is not a per-page
 * subdomain (apex, reserved/system label, `*.workers.dev`) resolves to null and
 * the Worker 404s.
 */

// ---------------------------------------------------------------------------
// Plain-data contract returned to the Worker. Mirrors worker/src/kv.ts
// `CachedRoute` field-for-field (the Worker JSON-parses this straight into one).
// ---------------------------------------------------------------------------

const serveRouteObject = v.object({
  pageId: v.string(),
  accountId: v.string(),
  version: v.number(),
  artifactKey: v.string(),
  lifecycle: v.union(
    v.literal("active"),
    v.literal("quarantined"),
    v.literal("tombstoned"),
  ),
  visibility: v.union(
    v.literal("public"),
    v.literal("unlisted"),
    v.literal("private"),
  ),
});

const serveRouteValidator = v.union(serveRouteObject, v.null());

/**
 * The account-domain resolver can also ask the Worker to REDIRECT: a bundle
 * entry hit at `<hostname>/<slug>` (no trailing slash) must 301 to
 * `<hostname>/<slug>/` so the entry's relative links resolve under `/<slug>/`
 * (they'd otherwise drop the slug and 404). A single-file page never redirects.
 */
const accountResolveValidator = v.union(
  serveRouteObject,
  v.object({ redirectTo: v.string() }),
  v.null(),
);

/**
 * CLOUD-SUBDOMAIN: extract the per-page subdomain label from a serve host, or
 * null when the host is not a single-label subdomain under a 2-label apex.
 *
 * The Vercel-style serve host is `<label>.shortwind.dev` — exactly ONE label in
 * front of the 2-label registrable apex (`shortwind.dev`). We treat any 3-label
 * host as `<label>.<apex>` and return the leading label, EXCEPT when that label
 * is a reserved/system subdomain (`c`, `www`, `api`, …) — those are system hosts
 * and never resolve as a page (→ null → Worker 404).
 *
 * A bare apex (`shortwind.dev`), a `*.workers.dev` host (4 labels), or any deeper
 * host returns null. Since serving is subdomain-only, a null here means the
 * request resolves to no page.
 */
export function subdomainLabel(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  const labels = h.split(".");
  // Exactly `<label>.<sld>.<tld>` — one label in front of a 2-label apex.
  if (labels.length !== 3) return null;
  const label = labels[0]!;
  if (label === "") return null;
  // Reserved/system labels are NOT page subdomains → null (no page resolves).
  if (isReservedSubdomain(label)) return null;
  return label;
}

/** Project a page row + its current version into the Worker route contract. The
 * artifactKey lives on the current pageVersions row; null when unpublished. */
function toServeRoute(
  page: Doc<"pages">,
  version: Doc<"pageVersions"> | null,
) {
  if (version === null) return null;
  return {
    pageId: page._id as string,
    accountId: page.accountId as string,
    version: page.currentVersion,
    artifactKey: version.artifactKey,
    lifecycle: page.lifecycle,
    visibility: page.visibility,
  };
}

/**
 * resolveRoute (GET /internal/resolve?host=&path=) — the Worker cold source.
 *
 * Maps an incoming hostname to the route record the Worker needs, or null when
 * no page maps to it. CLOUD-SUBDOMAIN: serving is SUBDOMAIN-ONLY — a page is
 * resolved EXCLUSIVELY by its per-page subdomain (`<label>.shortwind.dev` →
 * `by_subdomain`). The request `path` is irrelevant (a page serves at the host
 * root). A request whose host is NOT a per-page subdomain (the bare apex, a
 * reserved/system label like `c.shortwind.dev`, a `*.workers.dev` host, or any
 * non-3-label host) returns null → the Worker 404s. The legacy path-as-slug
 * fallback (`c.shortwind.dev/<slug>`) has been removed.
 *
 * Returns the FULL route incl. lifecycle/visibility even for tombstoned/
 * quarantined/private pages — the Worker enforces those states itself (410/451/
 * 401), which keeps the cold source a pure projection and lets the Worker cache
 * a "this is sealed" verdict instead of re-resolving every hit.
 */
export const resolveRoute = query({
  args: { host: v.string(), path: v.string() },
  returns: serveRouteValidator,
  handler: async (ctx, args) => {
    // SUBDOMAIN-ONLY: a per-page subdomain host (`<label>.shortwind.dev`, label
    // not reserved/system) resolves the page by its globally-unique `subdomain`
    // via the `by_subdomain` index. Any other host (apex, reserved label,
    // workers.dev, deeper host) is not a page → null (Worker 404).
    const label = subdomainLabel(args.host);
    if (label === null) return null;

    const page = await ctx.db
      .query("pages")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", label))
      .first();
    if (page === null) return null;

    // BUNDLE sub-page (CLOUD-50): if this page is a bundle's entry and the
    // request path names one of its sibling files, serve that sibling's frozen
    // artifact instead of the entry. Siblings inherit the entry page's
    // lifecycle/visibility (the whole unit is killed/gated together). A path
    // that is the root (`""`) or matches no sibling falls through to the entry
    // — so a single-file page is unaffected (its path is always ignored).
    const subPath = normalizeServePath(args.path);
    if (subPath !== "") {
      const bundleRows = await ctx.db
        .query("bundleVersions")
        .withIndex("by_entryPage", (q) => q.eq("entryPageId", page._id))
        .collect();
      const bundle =
        bundleRows.length === 0
          ? null
          : bundleRows.reduce((max, r) => (r.version > max.version ? r : max));
      const file = bundle?.files.find((f) => f.path === subPath);
      if (bundle && file) {
        return {
          pageId: page._id as string,
          accountId: page.accountId as string,
          version: bundle.version,
          artifactKey: file.artifactKey,
          lifecycle: page.lifecycle,
          visibility: page.visibility,
        };
      }
    }

    const version =
      page.currentVersionId === null
        ? null
        : await ctx.db.get(page.currentVersionId);
    return toServeRoute(page, version);
  },
});

/**
 * Parse the single-segment page slug from a serve PATH. Account-domain routing
 * maps `<hostname>/<slug>` → the page `(accountId, slug)`. The slug is exactly
 * ONE path segment: `/price-calculator` → `"price-calculator"`. The domain ROOT
 * (`/` or empty) has no page (product decision — no account index page) and a
 * NESTED path (`/a/b`) is not a page. Both return null → the Worker 404s. Pure.
 */
export function slugFromPath(path: string): string | null {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed.includes("/")) return null;
  return trimmed;
}

/**
 * resolveAccountDomainRoute (GET /internal/resolve-account?host=&path=) — the
 * Worker cold source for ACCOUNT-LEVEL custom domains. Resolves the incoming
 * host to the owning account's ACTIVE `accountDomains` row, then the first path
 * segment to that account's page `(accountId, slug)`. Both the host (unknown /
 * inactive domain) and the path (root / nested / unknown slug) can miss → null,
 * which the Worker 404s. This supersedes {@link resolveCustomDomain}: a domain
 * is an account alias, so one hostname fans out to every `<host>/<slug>` page.
 *
 * Route resolution is deterministic because slugs are unique PER ACCOUNT
 * (`by_slug`) and the host pins the account — the two ambiguities that made the
 * old path-as-slug fallback unsafe are both resolved here.
 */
export const resolveAccountDomainRoute = query({
  args: { host: v.string(), path: v.string() },
  returns: accountResolveValidator,
  handler: async (ctx, args) => {
    const host = args.host.toLowerCase().replace(/\.$/, "");
    if (host === "") return null;

    // Parse `<slug>[/<subpath>]`. Unlike single pages, a bundle serves its
    // sub-pages at `<hostname>/<slug>/<path>`, so we split the FIRST segment as
    // the slug and keep the rest as the bundle-relative sub-path.
    const trimmedLead = args.path.replace(/^\/+/, "");
    const firstSlash = trimmedLead.indexOf("/");
    const slug =
      firstSlash === -1
        ? trimmedLead.replace(/\/+$/, "")
        : trimmedLead.slice(0, firstSlash);
    const subPath =
      firstSlash === -1 ? "" : normalizeBundlePath(trimmedLead.slice(firstSlash + 1));
    const hadTrailingSlash = args.path.endsWith("/") && slug !== "";
    if (slug === "") return null;

    // Host → the owning account's ACTIVE domain (inactive/pending never serves).
    const domain = await ctx.db
      .query("accountDomains")
      .withIndex("by_hostname", (q) => q.eq("hostname", host))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (domain === null) return null;

    // (account, slug) → the page. Another account's slug is invisible here.
    const page = await ctx.db
      .query("pages")
      .withIndex("by_slug", (q) =>
        q.eq("accountId", domain.accountId).eq("slug", slug),
      )
      .unique();
    if (page === null) return null;

    // Is this page a bundle entry? (Highest-version bundleVersions row.)
    const bundleRows = await ctx.db
      .query("bundleVersions")
      .withIndex("by_entryPage", (q) => q.eq("entryPageId", page._id))
      .collect();
    const bundle =
      bundleRows.length === 0
        ? null
        : bundleRows.reduce((max, r) => (r.version > max.version ? r : max));

    if (subPath === "") {
      // Entry hit. For a bundle at `/<slug>` (no trailing slash), 301 to
      // `/<slug>/` so the entry's relative links resolve under `/<slug>/`.
      if (bundle && !hadTrailingSlash) {
        return { redirectTo: `/${slug}/` };
      }
      const version =
        page.currentVersionId === null
          ? null
          : await ctx.db.get(page.currentVersionId);
      return toServeRoute(page, version);
    }

    // Sub-path present. Only a bundle serves nested paths; a single-file page
    // does not (a nested path under it is a 404, as before).
    if (!bundle) return null;
    const file = bundle.files.find((f) => f.path === subPath);
    if (file) {
      return {
        pageId: page._id as string,
        accountId: page.accountId as string,
        version: bundle.version,
        artifactKey: file.artifactKey,
        lifecycle: page.lifecycle,
        visibility: page.visibility,
      };
    }
    // Unknown sub-path within a bundle → fall back to the entry (matches the
    // subdomain resolver's soft behavior rather than a hard 404).
    const version =
      page.currentVersionId === null
        ? null
        : await ctx.db.get(page.currentVersionId);
    return toServeRoute(page, version);
  },
});

/**
 * validateRouteToken (GET /internal/validate-token; bearer in Authorization
 * header, audit #5) — the private-page bearer check the Worker calls before
 * serving a `private` route.
 *
 * Returns `{ ok: true }` iff the bearer is a valid `pages:read` token whose
 * account OWNS the page. Re-uses {@link requireRead} so the validity + scope
 * rules are identical to the REST surface; an invalid/insufficient token throws,
 * which the HTTP route maps to `{ ok: false }` (the Worker then 401s).
 */
export const validateRouteToken = query({
  args: { bearer: v.string(), pageId: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const page = await ctx.db.get(args.pageId as Doc<"pages">["_id"]);
    // The token must belong to the page's owning account. A cross-account token
    // is valid auth but NOT authorized to read this private page.
    const ok = page !== null && page.accountId === auth.accountId;
    return { ok };
  },
});
