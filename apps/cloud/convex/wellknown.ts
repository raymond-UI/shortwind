/**
 * Standards-based discovery documents (CLOUD-42, PRD §7.3).
 *
 * PURE builders — no Convex imports, no IO. Each returns a plain JSON object
 * that `http.ts` serializes at a public `/.well-known/...` path. Keeping them
 * pure makes them byte-stable for a fixed base URL (golden fixtures) and lets
 * the auth/REST layers stay the single source of truth: the endpoints and
 * scopes here MUST mirror `convex/auth.ts` (device-flow grant) +
 * `shared/src/scopes.ts` + the `/v1/pages` REST surface in `http.ts`.
 *
 * The "works-as-agents-catch-up" layer (PRD §7.3): a sufficiently modern agent
 * fetches these two documents and self-discovers (a) HOW to authenticate
 * (RFC 8414 / 9728 authorization-server metadata → the RFC 8628 device grant)
 * and (b) WHAT verbs the platform exposes (RFC 9727 endpoint catalog). No docs,
 * no bespoke integration — the cross-agent thesis expressed in open standards.
 */

import {
  SCOPE_DOMAINS_BIND,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
} from "../shared/src/scopes.js";

/**
 * The well-known paths these documents are served at. RFC 8414 §3 fixes
 * `/.well-known/oauth-authorization-server`; RFC 9727 §3 fixes
 * `/.well-known/api-catalog`.
 */
export const OAUTH_AS_METADATA_PATH =
  "/.well-known/oauth-authorization-server";
export const API_CATALOG_PATH = "/.well-known/api-catalog";

/** Strip any trailing slash so we can join paths with a single `/`. */
function normalizeIssuer(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * RFC 8414 / RFC 9728 OAuth 2.0 Authorization Server Metadata.
 *
 * Advertises the RFC 8628 device-authorization grant the CLI/agent uses to
 * authenticate. The endpoint paths MUST match the ones the CLI POSTs to
 * (`cli/src/commands/login.ts`): `{issuer}/oauth/device/code` and
 * `{issuer}/oauth/token`. The scopes MUST match `shared/src/scopes.ts`.
 *
 * @param baseUrl deploy-time origin (the Convex http origin / auth issuer),
 *   env-injected at deploy (CLOUD-30b sets `SITE_URL` / the public base URL).
 */
export function buildOAuthAuthorizationServerMetadata(
  baseUrl: string,
): Record<string, unknown> {
  const issuer = normalizeIssuer(baseUrl);
  return {
    issuer,
    // RFC 8628 §3.1 device-authorization endpoint (CLI POSTs the client_id +
    // scope here to obtain device_code/user_code/verification_uri).
    device_authorization_endpoint: `${issuer}/oauth/device/code`,
    // RFC 6749 §3.2 token endpoint (CLI polls here with the device_code grant,
    // and later refreshes).
    token_endpoint: `${issuer}/oauth/token`,
    // The capability split is expressed natively as scopes (PRD §7.2).
    scopes_supported: [
      SCOPE_PAGES_READ,
      SCOPE_PAGES_WRITE,
      SCOPE_DOMAINS_BIND,
    ],
    // RFC 8628 device-code grant + RFC 6749 refresh-token grant (short-lived
    // access token + refresh token so revocation is a kill switch, PRD §7.1).
    grant_types_supported: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
    // The device flow returns tokens directly; there is no authorization-code
    // redirect surface, so the only response type is `token`.
    response_types_supported: ["token"],
    // The CLI is a PUBLIC client (no embedded secret, RFC 8628 §3.1); the
    // token endpoint therefore accepts the request without client auth.
    token_endpoint_auth_methods_supported: ["none"],
    // Bearer tokens authenticate subsequent API calls (Better Auth `bearer`).
    bearer_methods_supported: ["header"],
  };
}

/** One advertised REST verb in the RFC 9727 endpoint catalog. */
export interface ApiCatalogEntry {
  /** Stable verb name (mirrors the CLI verb + PRD §4 table). */
  rel: string;
  /** HTTP method. */
  method: string;
  /** Absolute URL template; `{id}` is an RFC 6570 path variable. */
  href: string;
  /** Human/agent-readable purpose. */
  description: string;
  /** Token scope required to call this verb (PRD §7.2), if any. */
  scope?: string;
}

/**
 * RFC 9727 API catalog — the platform's REST verbs (PRD §4) so an agent can
 * self-discover WHAT it can do after authenticating. Paths mirror the routes
 * registered in `http.ts` exactly.
 *
 * @param baseUrl deploy-time origin (same issuer as the auth metadata).
 */
export function buildApiCatalog(baseUrl: string): {
  apis: ApiCatalogEntry[];
} {
  const issuer = normalizeIssuer(baseUrl);
  return {
    apis: [
      {
        rel: "find",
        method: "GET",
        href: `${issuer}/v1/pages?q={q}&domain={domain}&tag={tag}`,
        description:
          "Locate existing pages before acting (rich query prevents duplicates).",
        scope: SCOPE_PAGES_READ,
      },
      {
        rel: "publish",
        method: "POST",
        href: `${issuer}/v1/pages`,
        description:
          "Create a page from HTML (+ lockfile, + touched recipes). Idempotency-keyed.",
        scope: SCOPE_PAGES_WRITE,
      },
      {
        rel: "publish-bundle",
        method: "POST",
        href: `${issuer}/v1/bundles`,
        description:
          "Publish a linked MULTI-PAGE site: an entry HTML file plus sibling pages, each served at its authored path under one subdomain (no link rewriting).",
        scope: SCOPE_PAGES_WRITE,
      },
      {
        rel: "update",
        method: "PATCH",
        href: `${issuer}/v1/pages/{id}`,
        description: "Republish to the same URL; previous versions retained.",
        scope: SCOPE_PAGES_WRITE,
      },
      {
        rel: "get",
        method: "GET",
        href: `${issuer}/v1/pages/{id}`,
        description:
          "Metadata + version list so the agent can confirm before acting.",
        scope: SCOPE_PAGES_READ,
      },
      {
        rel: "delete",
        method: "DELETE",
        href: `${issuer}/v1/pages/{id}`,
        description: "Tombstone a page (retained, not hard-deleted).",
        scope: SCOPE_PAGES_WRITE,
      },
      {
        rel: "visibility",
        method: "PATCH",
        href: `${issuer}/v1/pages/{id}/visibility`,
        description: "Set public / unlisted / private.",
        scope: SCOPE_PAGES_WRITE,
      },
      {
        rel: "bind-domain",
        method: "POST",
        href: `${issuer}/v1/pages/{id}/domain`,
        description:
          "Privileged: bind a custom hostname (human-gated step-up grant).",
        scope: SCOPE_DOMAINS_BIND,
      },
    ],
  };
}
