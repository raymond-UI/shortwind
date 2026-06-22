import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRead } from "./lib/auth_guard.js";
import { isReservedSubdomain } from "../shared/src/slug.js";

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

const serveRouteValidator = v.union(
  v.object({
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
  }),
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
    const version =
      page.currentVersionId === null
        ? null
        : await ctx.db.get(page.currentVersionId);
    return toServeRoute(page, version);
  },
});

/**
 * resolveCustomDomain (GET /internal/resolve-custom?host=) — the Worker custom-
 * hostname cold source (CLOUD-40). A bound `pages.customDomain` (Cloudflare for
 * SaaS) resolves to its page route via the `by_customDomain` index. Tried by the
 * Worker ONLY on a subdomain miss, so it never shadows the per-page subdomain hot
 * path. Like {@link resolveRoute} it returns the full projection (the Worker
 * enforces lifecycle/visibility itself); the HTTP route is shared-secret gated
 * (audit #7) so the projection is never publicly readable. Host is lowercased to
 * match the stored hostname.
 */
export const resolveCustomDomain = query({
  args: { host: v.string() },
  returns: serveRouteValidator,
  handler: async (ctx, args) => {
    const host = args.host.toLowerCase().replace(/\.$/, "");
    if (host === "") return null;
    const page = await ctx.db
      .query("pages")
      .withIndex("by_customDomain", (q) => q.eq("customDomain", host))
      .first();
    if (page === null) return null;
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
