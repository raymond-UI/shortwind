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

Recipes are optional. Plain HTML is uploaded and served untouched. This section
only applies when a page uses `@recipe` shorthand and you publish from a project
that has a `recipes/` directory: Cloud then expands the shorthand server-side,
and the publish carries what the expander needs:

- **`html`**: your source, with `@recipe` shorthand still in the `class`
  attributes.
- **`lockfile`**: pins the recipe versions the expansion resolves against.
- **`recipes`**: only the family bodies your page actually touches, not your
  whole palette.
- **`css`** (optional): extra CSS to include.

The CLI assembles this for you. It reads the palette from the `recipes/`
directory of the project you run `publish` in (it walks up from the current
directory to find one); if there is no such project, the palette is empty and
only plain HTML will publish cleanly. The publish itself is the sync: there is no
watcher and no separate sync step. A recipe edit only affects the next publish
that carries it, and published pages stay frozen against the version they
shipped with.

One practical rule: compose pages only from recipes that are actually present. A
recipe that is missing expands to nothing and goes out as raw text. Run
[`shortwind cloud skill`](/docs/cloud-cli) to print the palette available where
you are publishing from.

## Multi-page publishes

A single publish can ship more than one page. Pass `--bundle` and point it at an
entry file; the CLI publishes that file's whole directory as one linked unit
under a single slug:

```bash
shortwind cloud publish ./site/index.html --bundle --domain handbook
```

- The **entry** file (`index.html` above) serves at the slug root:
  `https://handbook.shortwind.app`.
- Every other `.html` file in the directory serves at its **authored path**:
  `site/about.html` becomes `https://handbook.shortwind.app/about.html`,
  `site/docs/guide.html` becomes `.../docs/guide.html`.
- Links between pages are ordinary **relative** links (`<a href="about.html">`,
  `<a href="../index.html">`). They resolve exactly as written, because each
  file is served at the path you authored it at. No rewriting, no absolute URLs.

The whole unit is one page as far as the rest of Cloud is concerned: it has one
slug, one visibility, one version, and a takedown or delete affects all of its
pages together.

A few constraints for this first release:

- **`.html` files only.** CSS, JS, and images in the directory are not bundled
  yet; style with inline CSS or a CDN (for example the Tailwind CDN) for now.
- **Relative links only.** A root-absolute link (`/about.html`) is treated as a
  site-root link, not a bundle link.
- **Re-publishing updates in place.** Publishing a bundle to a slug your account
  already owns updates it: the entry keeps its URL, a new immutable version is
  appended (prior versions retained), and added/removed sub-pages are reflected.
  A slug held by a non-bundle page, or by a deleted/quarantined one, still 409s.
- Caps: up to 2000 files and 50 MB per bundle.

## Finding and removing pages

```bash
shortwind cloud find --q "launch"     # search your pages
shortwind cloud get pg_abc123          # metadata + version list
shortwind cloud delete pg_abc123       # tombstone the page (prompts unless -y)
```

Deleting tombstones the page so it stops resolving. See
[trust & safety](/docs/cloud-api#trust-and-safety) for how abuse takedowns
differ from a user delete.
