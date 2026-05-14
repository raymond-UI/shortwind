# @shortwind/vite — Vite plugin

## Scope

Vite plugin that transforms source files before Tailwind's content scan and (re-)generates `SKILL.md` when recipes change in dev.

## Contract

```
shortwind(options?) → VitePlugin[]
```

Returns an array (one or more Vite plugin objects).

## Behavior

- Adds a `transform` hook for `.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.svelte`, `.astro`, `.html`, `.htm`. Calls `@shortwind/core` expand in `'jsx'` mode for the JS variants, `'html'` mode for HTML.
- Adds the `@shortwind/tailwind` plugin to the Tailwind chain (so registration is one call).
- In dev mode: hooks Vite's file watcher to `./recipes/`. On change, regenerates `SKILL.md` and triggers HMR for source files that reference changed recipes.
- In build mode: runs once, no watcher.
- Caches parsed recipes per Vite session.

## Tests (light)

- Smoke: a Vite project with `@card` in a `.tsx` file. Build output contains expanded classes.
- HMR: changing a recipe file triggers a re-transform of dependent source files.

## Out of scope

- SSR-specific hooks (works through standard Vite SSR by virtue of the transform).
