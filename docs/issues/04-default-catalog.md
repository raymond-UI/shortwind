# Default catalog — 19 families, ~100 recipes

## Scope

Author the source-of-truth recipe files in `packages/registry/recipes/`. These are what `shortwind add <family>` copies into user projects and what the catalog page on `shortwind.dev` displays.

## Families (19)

`card`, `button`, `badge`, `layout`, `text`, `form`, `surface`, `feedback`, `navigation`, `list`, `table`, `media`, `code`, `dialog`, `empty`, `progress`, `tooltip`, `skeleton`, `icon`.

One `.css` file per family.

## Recipe count per family (target)

| Family | Recipes |
|---|---|
| card | `card`, `card-elevated`, `card-flat`, `card-interactive`, `card-header`, `card-body`, `card-footer` (~7) |
| button | `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `btn-outline`, `btn-icon`, with `-sm`/`-lg` for primary/secondary/ghost (~12) |
| badge | `badge`, `badge-success`, `badge-warning`, `badge-danger`, `badge-info`, `badge-outline` (~6) |
| layout | `stack-xs`/`sm`/`md`/`lg`, `row`, `row-between`, `row-end`, `grid-2`/`3`/`4`, `center`, `full` (~12) |
| text | `heading-xl`/`lg`/`md`/`sm`, `body`, `muted`, `label`, `caption`, `link` (~9) |
| form | `input`, `input-error`, `textarea`, `select`, `checkbox`, `radio`, `field`, `field-error`, `fieldset`, `label`, `help` (~11) |
| surface | `surface`, `surface-muted`, `surface-accent`, `container`, `container-tight`, `divider-h`, `divider-v` (~7) |
| feedback | `alert`, `alert-success`/`warning`/`danger`/`info`, `callout`, `toast`, `banner` (~8) |
| navigation | `nav`, `nav-link`, `nav-link-active`, `breadcrumb`, `tab`, `tab-active` (~6) |
| list | `list`, `list-item`, `list-bordered`, `dl`, `dt`, `dd` (~6) |
| table | `table`, `th`, `td`, `tr-hover`, `table-zebra` (~5) |
| media | `avatar`, `avatar-sm`/`lg`, `thumb`, `aspect-square`, `aspect-video` (~6) |
| code | `code-inline`, `code-block`, `kbd` (~3) |
| dialog | `dialog`, `dialog-overlay`, `dialog-content`, `dialog-header`, `dialog-footer` (~5) |
| empty | `empty`, `empty-icon`, `empty-title`, `empty-description` (~4) |
| progress | `progress-track`, `progress-bar`, `spinner` (~3) |
| tooltip | `tooltip` (~1) |
| skeleton | `skeleton`, `skeleton-text`, `skeleton-circle` (~3) |
| icon | `icon-sm`/`md`/`lg`, `icon-muted` (~4) |

Total: ~115 recipes. Adjust as authoring reveals duplication or gaps.

## Requirements

- Every recipe carries a `/* description. */` comment on the line immediately above.
- Names follow `@<family>[-<intent>][-<size>]` order strictly.
- Recipes that have interactive states (hover/focus) bake them in (e.g. `@card-interactive` includes `hover:`, `focus-visible:`).
- Recipes work in both light and dark mode (use Tailwind's `dark:` variants where needed).
- Each file begins with a fingerprint header (`/* shortwind: <family>@0.0.1 sha:<6> ... */`) — `packages/registry/build.ts` generates the sha; authors write `0.0.1` and let CI lock it.
- Cross-family references are permitted but used sparingly (e.g. `@card-interactive` may reference `@card`).

## Presets (defined in this issue)

Write `packages/registry/presets.json`:

```json
{
  "starter": ["card", "button", "layout", "text", "form"],
  "app": ["card", "button", "layout", "text", "form", "badge", "table", "dialog", "list", "navigation", "feedback", "tooltip"],
  "content": ["card", "button", "layout", "text", "form", "badge", "code", "list", "media", "empty"],
  "all": "*"
}
```

## Tests

- Parser sanity: every recipe in the catalog parses cleanly.
- Resolver sanity: no cycles, no unknown references, no duplicate names.
- Snapshot: full registry expansion stays stable; intentional changes update the snapshot in the same PR.

## Out of scope

- Visual design QA (left to the catalog page reviewer in a later issue).
- Catalog website rendering.
