# apps/web — `/catalog` page

## Scope

The visual recipe browser. Marketing surface for Shortwind — every family in one scroll, every recipe with its expansion, every expansion with a rendered preview.

## Layout

- Sidebar: family list (sticky, scroll-spy).
- Main panel: one section per family. Each section shows:
  - Family name + description.
  - For each recipe in the family:
    - Name (with `@` prefix).
    - Description (from the leading comment).
    - Expanded Tailwind class list (syntax-highlighted).
    - A rendered preview using the expanded classes.
    - "Copy install command" button → `npx shortwind add <family>`.

## Two-layer hover

- Hover `@card-elevated` → tooltip shows description + flattened expansion.
- Hover `rounded-xl` inside an expansion → tooltip shows the underlying CSS (`.rounded-xl { border-radius: 0.75rem; }`). Static class-to-CSS map (~200KB JSON) generated at build time with `@tailwindcss/cli`.

## Data source

- `apps/web/public/registry/manifest.json` (built by 19).
- Individual recipe `.css` files for the source-view tab.

## Search

- Client-side search box (fuse.js or similar) across recipe names and descriptions.
- Keyboard shortcut: `/` to focus.

## Tests

- Visual regression (Playwright + screenshot) — deferred until visual design is locked.
- For now: smoke test that the page renders without errors against the built registry.

## Out of scope

- Editing recipes in the browser (read-only catalog).
- Account-bound favorites/saved recipes.
