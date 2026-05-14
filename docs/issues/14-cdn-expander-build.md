# Runtime CDN expander — `shortwind.dev/expand.js`

## Scope

A single-file browser build of `@shortwind/core` that walks the DOM and expands `@recipes` before first paint. The "Claude artifact pasted into a .html file" path.

## Build target

- ~6KB gzipped (Rollup/Rolldown, no source maps in prod).
- ESM, browser-only.
- Exposes globals: `window.shortwind = { expandDOM, registry, expand }`.
- Versioned filename: `expand@<semver>.js` (immutable) and `expand.js` (mutable latest).

## Behavior

When loaded via `<script src="https://shortwind.dev/expand.js" defer>`:

1. On `DOMContentLoaded`, walk the document, expand every `class="..."` attribute via `expandDOM`.
2. The registry is bundled in — the runtime ships the default catalog ~100 recipes.
3. Custom registries: support `<script src="..." data-registry="https://my-registry.example/manifest.json">`. Loads the manifest, fetches the families, builds a registry, then walks the DOM. Async — uses a `<style>` shim to hide content until expansion is done (avoids FOUC).
4. Idempotent: if `class` attribute already lacks `@`-prefixed tokens, leave it alone.

## Tests (medium)

- DOM expander: given a fixture document, after `expandDOM`, class attributes contain expanded classes and no `@` tokens.
- Idempotency: running twice produces the same output.
- Unknown `@recipe` is preserved (visible to view-source).
- Async registry loading: FOUC shim works (snapshot of inline style injection).
- Bundle size budget: build fails if `expand.js` exceeds 8KB gzipped.

## Out of scope

- DOM mutation observation (one-shot expansion at DOMContentLoaded — fine for LLM artifacts which are static).
- Server-side rendering (use the bundler plugins for that).
