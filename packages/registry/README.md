# @shortwind/catalog

The Shortwind recipe catalog — the built, versioned recipe files that the CLI installs from.

[Shortwind](https://shortwind.dev) is a token-efficient class layer for Tailwind: you write short `@recipe` names in `class=`/`className=` and they expand to full Tailwind class clusters at build time.

## You don't install this directly

This package is a **source of recipes**, not a runtime dependency. The CLI fetches the latest catalog from npm (falling back to a bundled copy offline) and **copies** the recipe files into your project's `./recipes/`, shadcn-style — so you own and can edit them. It won't appear in your `dependencies` or `devDependencies`.

```bash
npx @shortwind/cli@beta init      # pulls recipes from this catalog into ./recipes/
```

## What's inside

`dist/registry/` contains the published catalog:

- `recipes/<family>.css` — each family's `@recipe` definitions, sealed with a versioned, hash-checked header (`/* shortwind: <family>@<version> sha:<…> */`).
- `presets.json` — the named install presets (`starter`, `app`, `content`, `all`).
- `manifest.json` — the family list with versions.

Current families:

`badge` `button` `card` `code` `dialog` `empty` `feedback` `form` `icon` `layout` `list` `media` `navigation` `progress` `skeleton` `surface` `table` `text` `tooltip`

## Versioning

Each family is versioned independently; content changes are machine-checked against a committed ledger so a recipe body can't change without a version bump. The CLI's `upgrade` and `verify` commands use these versions and hashes to keep your vendored copies in sync (or flag intentional edits, which `shortwind reseal` re-signs).

Published on the `beta` tag. Docs: <https://shortwind.dev>
