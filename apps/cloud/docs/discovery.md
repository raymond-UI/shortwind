# Standards-based discovery (CLOUD-42)

Shortwind Cloud publishes two public `/.well-known/` documents so a sufficiently
modern agent can discover **how to authenticate** and **what verbs exist** with
no docs, no SDK, and no bespoke integration. This is PRD §7.3's
"works-as-agents-catch-up" layer — the cross-agent distribution thesis expressed
in open IETF standards rather than a proprietary protocol.

Both documents are served from the Convex HTTP origin (the same origin that
hosts Better Auth's device-flow endpoints and the `/v1/pages` REST surface).
They are **public** — no `Authorization` header required — because discovery
must precede authentication.

The two builders are pure functions in [`convex/wellknown.ts`](../convex/wellknown.ts)
and are wired into [`convex/http.ts`](../convex/http.ts). The issuer / base URL
is injected at deploy via the `SITE_URL` env var (the same origin
[`convex/auth.ts`](../convex/auth.ts) uses); CLOUD-30b sets this to the real
deployed origin.

## The cross-agent thesis

An agent runs in a terminal with no browser and no prior knowledge of this
platform. Given only the origin, it can:

1. `GET /.well-known/oauth-authorization-server` → learn the device-flow grant
   and the device/token endpoints.
2. Run the RFC 8628 device authorization grant (short user code + verification
   URL; human approves in a browser) → obtain a scoped bearer token.
3. `GET /.well-known/api-catalog` → learn the REST verbs (find / publish /
   update / get / delete / visibility / bind-domain) and the scope each needs.
4. Call the API.

No bespoke onboarding. Every step is a settled open standard, so any agent that
speaks these standards self-onboards.

## 1. `GET /.well-known/oauth-authorization-server`

OAuth 2.0 Authorization Server Metadata (RFC 8414, with the protected-resource
framing of RFC 9728). Advertises the RFC 8628 **device authorization grant** —
the correct pattern for a browser-less terminal agent (PRD §7.1), the same flow
the GitHub and AWS CLIs use.

```json
{
  "issuer": "https://cloud.shortwind.dev",
  "device_authorization_endpoint": "https://cloud.shortwind.dev/oauth/device/code",
  "token_endpoint": "https://cloud.shortwind.dev/oauth/token",
  "scopes_supported": ["pages:read", "pages:write", "domains:bind"],
  "grant_types_supported": [
    "urn:ietf:params:oauth:grant-type:device_code",
    "refresh_token"
  ],
  "response_types_supported": ["token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "bearer_methods_supported": ["header"]
}
```

| Field | Meaning |
| --- | --- |
| `issuer` | The deploy-time base URL (`SITE_URL`), trailing slash normalized. |
| `device_authorization_endpoint` | RFC 8628 §3.1. Where the CLI/agent POSTs `client_id` + `scope` to obtain `device_code` / `user_code` / `verification_uri`. Matches `cli/src/commands/login.ts`. |
| `token_endpoint` | RFC 6749 §3.2. Where the client polls with the device-code grant, and later refreshes. |
| `scopes_supported` | The three capability scopes (`shared/src/scopes.ts`). The default token gets `pages:read` + `pages:write`; `domains:bind` is a higher-consent step-up (PRD §7.2). |
| `grant_types_supported` | The RFC 8628 device-code grant + the RFC 6749 refresh-token grant (refresh enables revocation as a kill switch, PRD §7.1). |
| `token_endpoint_auth_methods_supported` | `none` — the CLI is a **public** client with no embedded secret (RFC 8628 §3.1); the human's approval is the gate. |
| `bearer_methods_supported` | `header` — a minted bearer token authenticates subsequent API calls (Better Auth `bearer` plugin). |

## 2. `GET /.well-known/api-catalog`

The RFC 9727 API catalog: the platform's REST verbs (PRD §4) so an agent can
self-discover what it can do once authenticated. Each entry carries the verb
name (`rel`), HTTP `method`, an absolute `href` URL template (RFC 6570 `{id}`
path variable), a `description`, and the `scope` required.

```json
{
  "apis": [
    { "rel": "find",        "method": "GET",    "href": ".../v1/pages?q={q}&domain={domain}&tag={tag}", "scope": "pages:read" },
    { "rel": "publish",     "method": "POST",   "href": ".../v1/pages",                                 "scope": "pages:write" },
    { "rel": "update",      "method": "PATCH",  "href": ".../v1/pages/{id}",                            "scope": "pages:write" },
    { "rel": "get",         "method": "GET",    "href": ".../v1/pages/{id}",                            "scope": "pages:read" },
    { "rel": "delete",      "method": "DELETE", "href": ".../v1/pages/{id}",                            "scope": "pages:write" },
    { "rel": "visibility",  "method": "PATCH",  "href": ".../v1/pages/{id}/visibility",                 "scope": "pages:write" },
    { "rel": "bind-domain", "method": "POST",   "href": ".../v1/pages/{id}/domain",                     "scope": "domains:bind" }
  ]
}
```

Every `method` + path mirrors a route registered in `convex/http.ts`. The
`scope` column mirrors the capability split: reads need `pages:read`, mutations
need `pages:write`, and `bind-domain` is gated to the privileged `domains:bind`
scope (human-gated, PRD §7.2).

## Keeping it honest

The discovery documents are not hand-maintained copies — they are derived from
the same sources of truth as the live surface:

- endpoints mirror `convex/auth.ts` + `cli/src/commands/login.ts`;
- scopes import from `shared/src/scopes.ts`;
- REST verbs mirror the `/v1/pages` routes in `convex/http.ts`.

`convex/wellknown.test.ts` pins both documents as **golden fixtures** for a
fixed issuer (byte-stable) and asserts the RFC-required fields plus that the
advertised endpoints/scopes match the auth config — so the discovery surface can
never silently drift from what actually authenticates.
