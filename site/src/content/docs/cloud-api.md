---
title: The agent API
description: The v1 REST surface an agent drives — find, publish, update, delete — plus auth and errors.
order: 4
product: cloud
---

# The agent API

The CLI is a thin wrapper over a small REST API. Anything the CLI does, an agent
can do directly over HTTP: find, publish, update, delete. The surface is
deliberately small enough to hold in one prompt.

## Base URL and auth

The API origin is:

```
https://api.shortwind.dev
```

Override it with the `--endpoint <url>` flag on any CLI verb, or the
`SHORTWIND_CLOUD_API` environment variable. Every request carries a bearer token
and JSON:

```
Authorization: Bearer <token>
Content-Type: application/json
```

Get a token with [`shortwind cloud login`](/docs/cloud-quickstart#1-log-in),
which runs the OAuth device flow described below.

## Pages

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/v1/pages?q=&tag=` | — | `{ pages: PageSummary[] }` |
| `GET` | `/v1/pages/{id}` | — | `{ page, versions }` or `404` |
| `POST` | `/v1/pages` | `PublishPayload` | `{ id, url, version }`, or `409 { existingId }` |
| `PATCH` | `/v1/pages/{id}` | `UpdatePayload` | `{ id, url, version }` |
| `PATCH` | `/v1/pages/{id}/visibility` | `{ visibility }` | updated `PageSummary` |
| `DELETE` | `/v1/pages/{id}` | — | tombstone lifecycle |

### Publish

```http
POST /v1/pages
{
  "html": "<main class=\"@hero\">…</main>",
  "lockfile": { … },
  "recipes": [{ "family": "layout", "source": "…" }],
  "slug": "launch-notes",
  "visibility": "public",
  "tags": ["launch"]
}

201 Created
{ "id": "pg_…", "url": "https://launch-notes.shortwind.app", "version": 1 }
```

`html`, `lockfile`, and `recipes` are the expansion inputs (see
[publishing](/docs/cloud-publishing#how-recipes-travel-with-a-publish)).
`slug`, `title`, `tags`, `visibility`, `css`, and `idempotencyKey` are optional.
`UpdatePayload` is the same shape minus `slug` (the URL is fixed to the existing
page).

A slug collision returns `409` with a top-level `existingId` so the caller can
switch to `PATCH /v1/pages/{existingId}`.

## Domains

Account-level custom domains (Pro). See [custom domains](/docs/cloud-domains).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/v1/domains` | `{ hostname }` | `DomainBindResult` (needs `domains:bind`) |
| `GET` | `/v1/domains` | — | `{ domains: AccountDomain[] }` |
| `POST` | `/v1/domains/approve` | `{ hostname }` | `DomainBindResult` |

## Authentication (OAuth device flow)

The CLI is a public client (`client_id = shortwind-cli`) using the RFC 8628
device authorization grant:

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/oauth/device/code` | form: `client_id`, `scope` | `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }` |
| `POST` | `/oauth/token` | form: device-code grant | `{ access_token, token_type, scope }` or `400 { error }` |

The client requests `pages:read` and `pages:write` by default; `domains:bind` is
requested as a step-up when you bind a domain. Discovery documents live at
`/.well-known/oauth-authorization-server` and `/.well-known/api-catalog`.

## Errors

Responses map to typed error kinds by status: `401` unauthorized, `403`
forbidden (missing scope), `404` not_found, `409` conflict (carries
`existingId`), plus network and generic http errors. Error bodies use the shape
`{ error: { code } }`.

## Trust and safety

Published pages are static artifacts, but the platform keeps two safety levers.

**Abuse reports** are unauthenticated and rate-limited per IP:

```http
POST /v1/abuse
{ "pageId": "pg_…", "reason": "…", "category": "phishing" }

202 { "state": "reported" }
```

`category` is one of `csam`, `phishing`, `malware`, or `other`. A report opens a
moderation case without pulling the page.

**Takedowns** are distinct from a user delete. A user `delete` tombstones a page;
an abuse takedown quarantines it, sealing the artifact so it stops resolving
within seconds while the object and version history are preserved (never
hard-deleted). Publishing also runs a content scan at publish time, and each
account has a publish rate limit (10/min sustained, burst of 5 at launch).
