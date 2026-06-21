/**
 * Page slug derivation / validation and the idempotent-publish collision signal
 * (PRD 3.2: "Publishing is idempotent on a stable handle: if a page already
 * exists at a slug ... the platform returns a 409 with the existing ID").
 *
 * Pure plain-data helpers — no IO, no classes. Expected-error cases return
 * result objects (`{ ok: false, error }`), never throws (CLAUDE.md).
 */

/** Result envelope mirroring core's `parse`/`resolve` convention. */
export type SlugResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Max slug length. Comfortably under DNS-label limits (custom domains bind a
 * subdomain off the slug) and keeps URLs human-typable.
 */
export const MAX_SLUG_LENGTH = 63;

/** Canonical slug grammar: lowercase alphanumerics in hyphen-separated groups. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Route slugs reserved by the platform — a page must never shadow a first-class
 * path. Kept lowercase to match the canonical slug form.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "api",
  "admin",
  "app",
  "auth",
  "dashboard",
  "docs",
  "find",
  "health",
  "internal",
  "login",
  "logout",
  "new",
  "settings",
  "static",
  "status",
  "www",
];

const RESERVED = new Set(RESERVED_SLUGS);

/**
 * Derive a canonical slug from arbitrary human input: lowercase, replace any
 * run of non-`[a-z0-9]` with a single hyphen, trim hyphens, truncate. Returns
 * `{ ok: false }` when nothing slug-able remains.
 */
export function deriveSlug(input: string): SlugResult {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized === "") {
    return { ok: false, error: "slug is empty: no usable characters in input" };
  }

  // Truncate, then re-trim in case the cut landed on a hyphen boundary.
  const truncated = normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  if (truncated === "") {
    return { ok: false, error: "slug is empty after truncation" };
  }

  return { ok: true, value: truncated };
}

/**
 * Validate that a slug is already canonical and not reserved. Use this on a
 * client-supplied slug (where the caller wants their exact handle honoured)
 * rather than silently rewriting it via `deriveSlug`.
 */
export function validateSlug(slug: string): SlugResult {
  if (slug.length === 0) {
    return { ok: false, error: "slug is empty" };
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return {
      ok: false,
      error: `slug exceeds ${MAX_SLUG_LENGTH} characters`,
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error:
        "slug must be lowercase alphanumerics separated by single hyphens (no leading/trailing/double hyphens)",
    };
  }
  if (RESERVED.has(slug)) {
    return { ok: false, error: `"${slug}" is a reserved slug` };
  }
  return { ok: true, value: slug };
}

// ---------------------------------------------------------------------------
// Idempotent-publish collision signal (PRD 3.2)
// ---------------------------------------------------------------------------

/** The minimal existing-page shape the collision check needs. */
export type ExistingPageRef = { id: string; slug: string };

/**
 * Result of checking a desired slug against the (possibly null) page already
 * occupying it. A collision is the 409-with-existing-id signal: the publish
 * surface returns it so the agent can "did you mean update?" instead of forking
 * a duplicate.
 */
export type SlugCollisionSignal =
  | { collision: false }
  | { collision: true; status: 409; existingId: string };

/**
 * Decide whether publishing to `desiredSlug` collides with `existing` (the page
 * currently at that slug for the account, or `null` if the slug is free).
 *
 * Pure: callers do the lookup and pass the result in.
 */
export function slugCollision(
  desiredSlug: string,
  existing: ExistingPageRef | null,
): SlugCollisionSignal {
  if (existing !== null && existing.slug === desiredSlug) {
    return { collision: true, status: 409, existingId: existing.id };
  }
  return { collision: false };
}
