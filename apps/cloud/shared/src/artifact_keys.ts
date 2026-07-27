/**
 * #232 — the STABLE R2 keys the serve path streams from.
 *
 * ONE definition, imported by BOTH trees:
 *   - Convex (`convex/lib/publish_core.ts`, `convex/bundles.ts`) writes them;
 *   - the Worker (`worker/src/router.ts`) derives them from the cached route.
 *
 * They used to be mirrored by hand in each tree with a "keep these in sync"
 * comment and nothing enforcing it. They live here instead because `shared/src`
 * is the one directory both trees already import (CLAUDE.md's dependency rule
 * forbids Convex importing the Worker, and vice versa — neither happens here:
 * both depend on this leaf). Pure string math, no IO, no Node/Workers globals.
 *
 * WHY A STABLE KEY. The immutable object is content-addressed
 * (`…/<expandedHash>.html`), so its key changes on every republish. A KV route
 * record carrying that key is stale the moment the page is updated, and only the
 * 1h route TTL cleared it. Serving from a key derived from the page's IDENTITY
 * instead means a republish is visible on the very next request with nothing to
 * invalidate. Publish writes the same bytes twice: once at the immutable key
 * (history/rollback/dedup) and once here. A second COPY rather than a pointer
 * object — a pointer would cost two R2 reads per view on the hot path.
 */

/**
 * The stable serve key for a single page (and for a bundle's ENTRY page, which
 * is an ordinary page): `artifacts/<accountId>/<pageId>/current.html`.
 *
 * CONCURRENCY (documented, not guarded — see the write site in
 * `convex/lib/publish_core.ts`): overwriting is safe against a SEQUENCE of
 * publishes (R2 is strongly consistent for same-key overwrites, so the next read
 * sees the last completed write), but two OVERLAPPING publishes of the same page
 * race on this key. If v2's PUT lands after v3's, this object holds v2 while the
 * DB says the current version is 3, and nothing self-corrects until the next
 * publish. R2's S3 API can condition a PUT on `If-Match`/`If-None-Match` (ETag),
 * but not on a custom-metadata comparison like "only if the stored version is
 * lower", so ordering by version would need a read-modify-write CAS loop.
 */
export function currentArtifactKey(accountId: string, pageId: string): string {
  return `artifacts/${accountId}/${pageId}/current.html`;
}

/**
 * The stable serve key for a bundle SIBLING file:
 * `bundles/<accountId>/<entryPageId>/<path>/current.html`.
 *
 * A sibling is its own document (not the entry page's), so it cannot resolve to
 * the entry's `current.html` — it gets the same treatment one level down, keyed
 * by the bundle's stable identity (its entry page id) plus the authored path.
 *
 * `path` MUST already be canonical (`convex/lib/bundle_path.ts`
 * `normalizeBundlePath` / `normalizeServePath`: no leading slash, no `.`/`..`
 * segments) — it is the same string stored on `bundleVersions.files[].path`, so
 * the writer and the router derive identical keys. Normalization deliberately
 * does NOT happen here: the Worker never sees a raw authored path (it gets the
 * normalized one back on the route record), so duplicating the normalizer into
 * this leaf would create the very drift this module exists to remove.
 */
export function bundleCurrentKey(
  accountId: string,
  entryPageId: string,
  path: string,
): string {
  return `bundles/${accountId}/${entryPageId}/${path}/current.html`;
}
