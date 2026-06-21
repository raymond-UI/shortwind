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
 * Subdomain labels reserved by the platform — a page's subdomain must never
 * shadow a system hostname under `*.shortwind.dev`. Kept lowercase to match the
 * canonical DNS-label form. A derived subdomain that would land on one of these
 * is suffixed (`<slug>-<id>`) instead, and the serve resolver refuses to resolve
 * these labels as pages so a system host (e.g. `c.shortwind.dev`) is never
 * shadowed by a page.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www",
  "c",
  "api",
  "app",
  "dashboard",
  "cloud",
  "@", // the apex marker — never a page label.
];

const RESERVED_SUBDOMAIN_SET = new Set(RESERVED_SUBDOMAINS);

/** True when `label` is a platform-reserved/system subdomain (no page may take it). */
export function isReservedSubdomain(label: string): boolean {
  return RESERVED_SUBDOMAIN_SET.has(label.toLowerCase());
}

/**
 * Mint a short, lowercase, DNS-label-safe id used to disambiguate a colliding
 * subdomain (`<slug>-<id>`). 6 chars from a 32-symbol alphabet (no vowels/ambiguous
 * chars) → ~10^9 space, plenty for collision-avoidance with a retry loop.
 *
 * Pure-ish: takes an injected `rand` (defaults to `Math.random`) so callers/tests
 * can make it deterministic. Returns only `[a-z0-9]`, so the result is always a
 * valid slug fragment.
 */
const SUBDOMAIN_ID_ALPHABET = "0123456789bcdfghjkmnpqrstvwxyz";

export function mintSubdomainId(
  length = 6,
  rand: () => number = Math.random,
): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(rand() * SUBDOMAIN_ID_ALPHABET.length);
    out += SUBDOMAIN_ID_ALPHABET[idx] ?? "0";
  }
  return out;
}

/**
 * Derive the globally-unique subdomain label for a page (the Vercel hybrid):
 * the bare `slug` when it is free across ALL accounts AND not a reserved/system
 * label, else `slug-<id>` re-minted until unique. Pure: the caller passes an
 * `isTaken(label)` predicate that consults the global `by_subdomain` index and a
 * `mint()` that produces the disambiguating id (defaults to {@link mintSubdomainId}).
 *
 * The bare slug already satisfies the DNS-label grammar (it is a validated slug),
 * and `<slug>-<id>` stays a valid label because the id is `[a-z0-9]`. The combined
 * length is bounded by clamping the slug so `slug-id` never exceeds the label cap.
 */
export async function deriveSubdomain(
  slug: string,
  isTaken: (label: string) => Promise<boolean>,
  mint: () => string = () => mintSubdomainId(),
): Promise<string> {
  // The bare slug wins when it is globally free and not a reserved system label.
  if (!isReservedSubdomain(slug) && !(await isTaken(slug))) {
    return slug;
  }
  // Otherwise disambiguate: clamp the slug so `slug-<id>` fits the label cap, then
  // re-mint the id until the label is globally free (and never reserved — the id
  // suffix makes a reserved bare label non-reserved, but we re-check defensively).
  const id0 = mint();
  const maxSlug = Math.max(1, MAX_SLUG_LENGTH - (id0.length + 1));
  const stem = slug.slice(0, maxSlug).replace(/-+$/g, "") || slug.slice(0, maxSlug);
  // Bounded retry — practically never loops more than once at this id space.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = attempt === 0 ? id0 : mint();
    const label = `${stem}-${id}`;
    if (!isReservedSubdomain(label) && !(await isTaken(label))) {
      return label;
    }
  }
  // Exhausted (astronomically unlikely): fall back to a fresh long id.
  return `${stem}-${mint()}${mint()}`;
}

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
