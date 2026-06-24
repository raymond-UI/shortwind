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

/** The canonical live URL for a page: its custom domain if bound, else slug subdomain. */
export function pageUrl(slug: string, customDomain: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  return `https://${slug}.${PAGES_BASE}`;
}

/** The hostname shown on a card (no scheme), for compact display. */
export function pageHost(slug: string, customDomain: string | null): string {
  return customDomain ?? `${slug}.${PAGES_BASE}`;
}
