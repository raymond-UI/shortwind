---
title: shortwind cloud CLI
description: Every shortwind cloud verb and its flags.
order: 5
product: cloud
---

# shortwind cloud CLI

The Cloud verbs live under the `cloud` namespace of the `@shortwind/cli`
package. Run them with `shortwind cloud <verb>` (or `npx @shortwind/cli@beta
cloud <verb>`). Most verbs accept two shared flags: `--endpoint <url>` to point
at a different Cloud API origin, and `--json` for machine-readable output.

## `shortwind cloud login`

Authenticate via the OAuth device flow and store a token in the global Shortwind
home. Prints a verification URL and code to enter in a browser, then polls until
approved. Requests `pages:read` and `pages:write` by default; pass
`--scope <scope>` (repeatable) to request more, e.g. `--scope domains:bind`.

## `shortwind cloud init-global`

Create the global Shortwind home (`~/.shortwind/`) that holds your credentials
and recipe palette. `--force` overwrites an existing home.

## `shortwind cloud publish <file>`

Create a page from an HTML file (`POST /v1/pages`). Expands the file's recipes
server-side, freezes version 1, and prints the live URL, id, and version.

- `--domain <slug>`: desired subdomain/slug.
- `--tag <tag>`: attach a tag (repeatable).
- `--visibility <level>`: `public` | `unlisted` | `private`.
- `--idempotency-key <key>`: safe-retry key.
- `--bundle`: publish `<file>`'s whole directory as a linked multi-page unit,
  with `<file>` as the entry point. See
  [multi-page publishes](/docs/cloud-publishing#multi-page-publishes).

On a slug collision it prints the existing page id and the `update` command to
reuse it.

## `shortwind cloud update <id> <file>`

Republish HTML to the same URL as a new version (`PATCH /v1/pages/{id}`).
Accepts `--idempotency-key <key>`.

## `shortwind cloud find`

Locate existing pages (`GET /v1/pages`). Prints a table of id, slug, version,
visibility, and tags, or `no pages found`.

- `--q <query>`: free-text query.
- `--tag <tag>`: filter by tag (repeatable).

## `shortwind cloud get <id>`

Fetch page metadata and the full version list (`GET /v1/pages/{id}`).

## `shortwind cloud delete <id>`

Tombstone a page so it stops resolving (`DELETE /v1/pages/{id}`). Prompts for
confirmation unless you pass `-y` / `--yes`.

## `shortwind cloud visibility <id> <level>`

Set a page's visibility to `public`, `unlisted`, or `private` without
republishing (`PATCH /v1/pages/{id}/visibility`).

## `shortwind cloud bind-domain <hostname>`

Bind an account-level custom domain (`POST /v1/domains`). Requires the
`domains:bind` scope; if your token lacks it, the CLI re-runs login to step up
for this one operation. See [custom domains](/docs/cloud-domains).

## `shortwind cloud domains`

List the account's custom domains and their status (`GET /v1/domains`).

## `shortwind cloud approve-domain <hostname>`

Approve a domain sitting at `pending-human` (`POST /v1/domains/approve`).

## `shortwind cloud skill`

Emit a `SKILL.md` describing the Cloud verbs and this account's current recipe
palette, so a coding agent knows both what it can publish with and which recipes
exist. Writes to stdout, or to a file with `--out <file>`.
