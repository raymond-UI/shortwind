# Shortwind Cloud: publishing reference

Companion to the `shortwind-cloud` SKILL. Every command here follows the invocation rules in `SKILL.md`: `shortwind cloud <verb>` when it is on PATH, otherwise `npx -y @shortwind/cli cloud <verb>`.

## A single page

```
shortwind cloud publish report.html --domain q3-report --visibility unlisted --json
```

The file uploads as-is. Inline CSS, inline JS, CDN `<script>`/`<link>` tags, data URIs, and absolute image URLs all keep working, because nothing is bundled or rewritten.

A single-page publish carries exactly one file, so a local relative asset (`./logo.png`) is NOT uploaded and will 404. Inline it, use a data URI, point at an absolute URL, or publish the directory with `--bundle`.

The response carries `id`, `url`, and `version`. Treat `url` as authoritative and never assemble one from the slug by hand; the host shape is the platform's to decide.

## A multi-page site

```
shortwind cloud publish site/index.html --bundle --domain my-site --json
```

- Deploys every `.html` file under the entry file's directory as ONE unit. The entry is what the slug resolves to.
- Each file serves at its authored path: `index.html` at `/`, `docs/guide.html` at `/docs/guide.html`.
- Relative links between those pages work exactly as written. There is no link rewriting, so author `<a href="docs/guide.html">` normally.
- The bundle is one unit for versioning, visibility, and takedown; it inherits the entry page's lifecycle.

## Slugs

- `--domain <slug>` sets the handle. Grammar: lowercase letters and digits in hyphen-separated groups, up to 63 characters (`q3-report`, `acme-pricing-v2`).
- Pick something a human would recognize: the product or the document, not the file name or the framework.
- These handles are reserved and will be refused: api, admin, app, auth, dashboard, docs, find, health, internal, login, logout, new, settings, static, status, www.
- Omit `--domain` and the server derives a handle from the document. Pass it explicitly instead; a derived handle is not something to hand to a person.
- Publishing to a slug this account already uses returns 409 WITH the existing page id. That is the signal to `update <id> <file>`, not to pick a different slug.

## Visibility

Set it at publish time with `--visibility`, or afterwards with `shortwind cloud visibility <id> <level>`.

- `public`: listed and indexable.
- `unlisted`: reachable by anyone holding the link, but not listed. The right choice for a mockup or draft shared in an issue or a chat.
- `private`: requires an authenticated session on the owning account. Do not use it for a link someone else must open; they will hit a login wall.

Prefer `unlisted` when the user just wants a link to share, and confirm before publishing anything `public` on their behalf.

## Tags

`--tag` is repeatable and is the only retrieval handle besides the slug. Tag on the way in, because `find --tag` is how a later session finds the page again.

```
shortwind cloud publish mock.html --domain acme-mock --tag acme --tag design-mock
```

## Revising a page

```
shortwind cloud find --q acme --json      # recover the id
shortwind cloud update <id> mock.html --json
```

`update` republishes to the same URL as a new version; `get <id> --json` lists the version history. Published versions are frozen, so an update adds a version rather than mutating the last one.

## Custom domains

Custom domains bind to the ACCOUNT, not to an individual page.

```
shortwind cloud domains --json
shortwind cloud bind-domain mockups.acme.com --json
shortwind cloud approve-domain mockups.acme.com --json
```

`bind-domain` needs the `domains:bind` scope. If it returns a scope error, re-run `shortwind cloud login --scope domains:bind`. A domain can land in a pending-human state that `approve-domain` clears once DNS verification passes.

## When something fails

| Symptom | Meaning | Do this |
| --- | --- | --- |
| `command not found` | The binary is not on this shell's PATH | Re-run via `npx -y @shortwind/cli cloud ...`. This is not a blocker. |
| 401 | No token, or it expired | `shortwind cloud login`, then retry. |
| 403 naming a scope | The token lacks that scope | Re-run login with `--scope <name>`. |
| 409 on publish | The slug is taken; the response carries the existing id | `update <id> <file>`. Do not invent a new slug. |
| A URL full of markup words | `--domain` was omitted, so the handle came from the document | `update` cannot move a URL: publish once at the right slug, then `delete` the wrong page. |
| Raw `@name` text visible on the page | A recipe this account does not ship | Remove it, or use a name from `recipes.md`. |

Retrying a publish that may have partly succeeded: pass the same `--idempotency-key <key>` and the retry returns the original result instead of creating a second page.

## Cleaning up

```
shortwind cloud delete <id> --yes --json
```

Deletion is a tombstone: the URL stops serving. Pass `--yes` when running unattended, or the command waits on a confirmation prompt. Deleting a page whose link a human already holds is destructive, so confirm before doing it.
