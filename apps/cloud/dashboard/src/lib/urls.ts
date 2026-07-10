/**
 * Served-page URL helpers for the dashboard (epic #184).
 *
 * The backend computes the canonical URL from `PAGES_BASE_URL`, but the
 * dashboard's `listPages` rows don't carry it, so we reconstruct the display URL
 * client-side from the slug. The base is overridable via the Vite env so a
 * staging dashboard points at the right zone; default matches the public apex.
 */

const PAGES_BASE: string =
  (import.meta.env?.VITE_PAGES_DOMAIN as string | undefined) ?? "shortwind.app";

/**
 * The canonical live URL for a page: its `<slug>.shortwind.app` vanity
 * subdomain. Custom domains are ACCOUNT-level now (a page also serves at
 * `<account-domain>/<slug>`); the Domains view surfaces those separately.
 */
export function pageUrl(slug: string): string {
  return `https://${slug}.${PAGES_BASE}`;
}

/** The hostname shown on a card (no scheme), for compact display. */
export function pageHost(slug: string): string {
  return `${slug}.${PAGES_BASE}`;
}

/**
 * A page's URL under an ACTIVE account-level custom domain — domains alias the
 * account and pages are path-routed beneath them (`<hostname>/<slug>`, see
 * serve.resolveAccountDomainRoute).
 */
export function accountDomainPageUrl(hostname: string, slug: string): string {
  return `https://${hostname}/${slug}`;
}

/** The compact no-scheme display form of `accountDomainPageUrl`. */
export function accountDomainPageHost(hostname: string, slug: string): string {
  return `${hostname}/${slug}`;
}
