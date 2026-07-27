/**
 * #232 — the SIBLING paths a page's edge eviction has to cover.
 *
 * A bundle is entry-as-page: the entry is an ordinary `pages` row, and its
 * sibling files serve at `<subdomain>.<root>/<path>` through that same row
 * (convex/serve.ts resolves them via the page's highest `bundleVersions` row).
 * Each sibling is therefore its OWN route key in the Worker's ROUTES KV, and its
 * own edge-cache entry.
 *
 * The lifecycle/visibility evictions used to drop only the entry's route key
 * (`route:<subdomain>.<root>/`). That is a security hole, not just staleness: a
 * `public → private` flip, a delete, a kill, or an expiry sweep left every
 * sibling's cached record saying `public`/`active`, so the Worker kept serving
 * those pages with no bearer check (and no 410/451) for up to the 1h route TTL.
 * The siblings inherit the entry's lifecycle + visibility, so they have to be
 * pulled with it.
 *
 * This module is the ONE place that enumerates them. It lives in `convex/lib`
 * rather than in `bundles.ts` because BOTH `pages.ts` (delete / visibility /
 * scan-block / expiry sweep) and `moderation.ts` (kill) need it, and the
 * dependency direction is fixed: `bundles.ts` imports `pages.ts`, `pages.ts`
 * imports `moderation.ts`. A leaf both can import is the only non-cyclic home.
 */
import type { Id } from "../_generated/dataModel.js";

/**
 * The slice of a Convex ctx this needs: just a db reader. Declared structurally
 * so a mutation ctx, a query ctx, and the offline test harness all satisfy it
 * without importing Convex's server generics.
 */
export interface BundleReaderCtx {
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (table: "bundleVersions") => any;
  };
}

/**
 * The canonical bundle-relative paths of the CURRENT bundle version whose entry
 * is `entryPageId`, or `[]` when the page is not a bundle entry.
 *
 * "Current" is the highest `version` row, matching how `convex/serve.ts` picks
 * the bundle it resolves siblings against — so the evicted keys are exactly the
 * keys the serve path would hand out.
 *
 * ONLY the current version's paths. An older version's siblings are not
 * reachable through the serve path (it always resolves against the highest
 * version), so they have no live route key to evict.
 *
 * FAIL-SAFE, like every other step on the eviction path: a read failure returns
 * `[]` rather than throwing, because this is called from inside a kill/delete
 * mutation whose DB transition is the source of truth. Losing the sibling list
 * degrades to stale-until-TTL on the siblings; it must never abort the takedown.
 */
export async function bundleSiblingPaths(
  ctx: BundleReaderCtx,
  entryPageId: Id<"pages">,
): Promise<string[]> {
  try {
    const rows = await ctx.db
      .query("bundleVersions")
      .withIndex("by_entryPage", (q: { eq: (f: string, v: unknown) => unknown }) =>
        q.eq("entryPageId", entryPageId),
      )
      .collect();
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const current = rows.reduce(
      (max: { version: number }, r: { version: number }) =>
        r.version > max.version ? r : max,
    );
    const files: { path: string }[] = current.files ?? [];
    return files.map((f) => f.path).filter((p) => typeof p === "string" && p !== "");
  } catch (err) {
    console.error(
      `[bundle_routes] failed to enumerate sibling paths for ${entryPageId}:`,
      err,
    );
    return [];
  }
}
