# @shortwind/cloud

Agent-native HTML hosting for Shortwind. An agent authors a page with Shortwind
shorthand (`class="@card"`), publishes it once, and the platform expands it
server-side into frozen Tailwind, stores the artifact, and serves it from the
edge. The expensive, stateful work happens once at publish; serving is dumb,
static file delivery.

This is a **private, unpublished** package (`"private": true`). It is the
deployable application, not a library.

## Self-contained workspace

`apps/cloud/` is its **own pnpm workspace root** — it carries its own
`pnpm-workspace.yaml` (with `packages: []`) and its own `pnpm-lock.yaml`, and is
deliberately **not** listed in the repo-root `pnpm-workspace.yaml`.

Why: the cloud app depends on the *published* `@shortwind/core` (pinned to
`0.1.0-beta.19`), not on `workspace:*`. Decoupling it from the monorepo above
means `pnpm install` here resolves `@shortwind/*` from the npm registry exactly
as an external consumer would, so we dogfood the published artifact and never
accidentally couple the hosting product to unreleased core changes. This mirrors
the established `site/` precedent.

Run every command against this workspace explicitly:

```sh
pnpm -C apps/cloud install
pnpm -C apps/cloud exec tsc --noEmit
pnpm -C apps/cloud test
```

## How it consumes @shortwind/core

The publish path imports `expand`, `buildRegistry`, and `parseRecipeFile` from
`@shortwind/core` to turn shorthand + a resolved recipe set into frozen Tailwind
HTML and scoped CSS. Core is pure (zero IO); the cloud adapter does all IO —
Convex (system of record), R2 (artifacts), KV (hot cache), and the Cloudflare
Worker (serve router). The `CLAUDE.md` dependency direction holds: cloud is an
adapter consuming core, never the reverse.

## Layout

```
apps/cloud/
  shared/      pure plain-data helpers + types shared across surfaces
  convex/      control plane / system of record (accounts, pages, tokens, audit)
  worker/      Cloudflare Worker serve router (hot path) + edge bindings
  cli/         the shortwind-cloud CLI (login, publish, find, get, ...)
  dashboard/   human oversight UI (audit log, recipe-edit visibility)
```

Most of these directories are stubs at this point; they are filled in by later
waves of the `shortwind-cloud` plan (`docs/shortwind-cloud/issues.json`).
