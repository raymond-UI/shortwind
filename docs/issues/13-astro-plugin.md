# @shortwind/astro — Astro integration

## Scope

Astro integration following the official integration API.

## Contract

```
// astro.config.mjs
import shortwind from '@shortwind/astro'

export default defineConfig({
  integrations: [shortwind()]
})
```

## Behavior

- Hooks Astro's Vite layer (Astro uses Vite under the hood).
- Transforms `.astro`, `.tsx`, `.jsx`, `.vue`, `.svelte` files.
- Watches `./recipes/` in dev.

## Tests (light)

- Smoke: Astro project with `@card` in an `.astro` template. `astro build` succeeds, output HTML contains expanded classes.

## Out of scope

- Content Collections-specific behavior.
