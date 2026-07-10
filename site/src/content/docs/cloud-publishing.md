---
title: Publishing & versions
description: The immutable-version model, slugs, visibility, tags, and how recipes travel with a publish.
order: 2
product: cloud
---

# Publishing & versions

A publish takes an HTML file, expands its recipes, and stores a frozen artifact
served at a URL. This page covers the model behind that: versions, slugs,
visibility, and what actually gets uploaded.

## Immutable versions

Every publish and every update creates one new immutable version. Prior versions
are frozen and retained; nothing is overwritten in place. A **publish** mints a
new page (version 1) at a fresh URL. An **update** adds a version to an existing
page and keeps the same URL.

```bash
shortwind cloud publish ./page.html          # -> page, v1, new URL
shortwind cloud update pg_abc123 ./page.html  # -> same URL, v2
```

Use [`shortwind cloud get <id>`](/docs/cloud-cli) to see a page's full version
history.

### Idempotency

Both publish and update accept `--idempotency-key`. A retry with the same key
returns the same result instead of creating a duplicate version, so an agent can
safely re-send a request after a network hiccup:

```bash
shortwind cloud publish ./page.html --idempotency-key launch-2026-07-10
```

## Slugs and URLs

Free pages serve at a per-page subdomain on `shortwind.app`:

```
https://<slug>.shortwind.app
```

Pass `--domain <slug>` to choose the slug; omit it and one is assigned. If the
slug you want is taken, publish returns a `409` and the CLI prints the id of the
page already holding it, plus the `update` command to reuse it.

On Pro, a bound custom domain also serves every page at `your-domain/<slug>`.
See [custom domains](/docs/cloud-domains).

## Visibility

Every page is `public`, `unlisted`, or `private`. Set it at publish time with
`--visibility`, or change it later without republishing:

```bash
shortwind cloud publish ./page.html --visibility private
shortwind cloud visibility pg_abc123 public
```

- **public**: served to anyone and discoverable.
- **unlisted**: served to anyone with the URL, not discoverable.
- **private**: not served publicly.

## Tags

Attach tags at publish time (`--tag`, repeatable) and filter on them in `find`.
Tags are how an agent groups and re-locates its own pages:

```bash
shortwind cloud publish ./page.html --tag launch --tag q3
shortwind cloud find --tag launch
```

## How recipes travel with a publish

Cloud expands `@recipe` classes server-side, so a publish carries what the
expander needs:

- **`html`**: your source, with `@recipe` shorthand still in the `class`
  attributes.
- **`lockfile`**: pins the recipe versions the expansion resolves against.
- **`recipes`**: only the family bodies your page actually touches, not your
  whole palette.
- **`css`** (optional): extra CSS to include.

The CLI assembles this for you from your Shortwind home's `recipes/` directory.
The publish itself is the sync: there is no watcher and no separate sync step. A
recipe edit only affects the next publish that carries it, and published pages
stay frozen against the version they shipped with.

One practical rule: compose pages only from recipes your account ships. A recipe
the account does not have expands to nothing and goes out as raw text. Run
[`shortwind cloud skill`](/docs/cloud-cli) to print the account's current
palette before composing.

## Finding and removing pages

```bash
shortwind cloud find --q "launch"     # search your pages
shortwind cloud get pg_abc123          # metadata + version list
shortwind cloud delete pg_abc123       # tombstone the page (prompts unless -y)
```

Deleting tombstones the page so it stops resolving. See
[trust & safety](/docs/cloud-api#trust-and-safety) for how abuse takedowns
differ from a user delete.
