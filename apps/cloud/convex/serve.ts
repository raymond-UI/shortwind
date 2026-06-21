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
 * Slug resolution (v1, single-account demo): a workers.dev request path IS the
 * page slug (`/hello` → slug `hello`). The `pages.by_slug` index keys on
 * (accountId, slug), so a slug-only lookup can't use it directly; for v1 we scan
 * the (small) pages table and match the slug. A multi-account launch resolves the
 * account from the hostname first (custom domain / subdomain) and then hits
 * `by_slug` — that lands with the bind-domain work, not here.
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

/** Normalize an incoming serve path to a slug: strip the leading slash, drop a
 * trailing slash, and treat the bare root ("/") as empty (no page). */
export function pathToSlug(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed;
}

/**
 * CLOUD-SUBDOMAIN: extract the per-page subdomain label from a serve host, or
 * null when the host is not a single-label subdomain under a 2-label apex.
 *
 * The Vercel-style serve host is `<label>.shortwind.dev` — exactly ONE label in
 * front of the 2-label registrable apex (`shortwind.dev`). We treat any 3-label
 * host as `<label>.<apex>` and return the leading label, EXCEPT when that label
 * is a reserved/system subdomain (`c`, `www`, `api`, …) — those are system hosts
 * (e.g. the legacy `c.shortwind.dev` path-based serve, `…workers.dev`) and MUST
 * fall through to path-based resolution, never resolve as a page.
 *
 * A bare apex (`shortwind.dev`), a `*.workers.dev` host (4 labels, leading label
 * is the script name = reserved-ish but more importantly NOT a 3-label host), or
 * any deeper host returns null → the caller uses path-as-slug resolution. This
 * keeps the existing `c.shortwind.dev/<slug>` and `…workers.dev/<slug>` serving
 * working unchanged.
 */
export function subdomainLabel(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  const labels = h.split(".");
  // Exactly `<label>.<sld>.<tld>` — one label in front of a 2-label apex.
  if (labels.length !== 3) return null;
  const label = labels[0]!;
  if (label === "") return null;
  // Reserved/system labels are NOT page subdomains — fall through to path-based.
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
 * Maps an incoming hostname/path to the route record the Worker needs, or null
 * when no page maps to it. v1: the path is the page slug; we resolve the slug
 * across the (single-account demo) pages table. `host` is accepted for forward
 * compatibility (custom-domain resolution) and currently informational.
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
    // 1. CLOUD-SUBDOMAIN: a per-page subdomain host (`<label>.shortwind.dev`,
    //    label not reserved/system) resolves the page by its globally-unique
    //    `subdomain` via the `by_subdomain` index. This is the Vercel-style hot
    //    path; the request path is irrelevant (the page serves at the host root).
    const label = subdomainLabel(args.host);
    if (label !== null) {
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
    }

    // 2. LEGACY path-based serving (backward-compat): the request path IS the
    //    page slug (`c.shortwind.dev/<slug>`, `…workers.dev/<slug>`). Kept so the
    //    live demo (`c.shortwind.dev/cloud-ops`) and any older link still serve.
    const slug = pathToSlug(args.path);
    if (slug === "") return null;

    // v1 single-account demo: the by_slug index is (accountId, slug), so a
    // slug-only lookup scans. The demo deployment holds few pages; a multi-
    // account launch resolves the account from the host FIRST (bind-domain work).
    const page = await ctx.db
      .query("pages")
      .filter((q) => q.eq(q.field("slug"), slug))
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
 * validateRouteToken (GET /internal/validate-token?bearer=&pageId=) — the
 * private-page bearer check the Worker calls before serving a `private` route.
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
