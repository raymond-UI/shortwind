# @shortwind/next — Next.js plugin

## Scope

Webpack + Turbopack integration for Next.js projects.

## Contract

```
// next.config.js / next.config.mjs
import { withShortwind } from '@shortwind/next'

export default withShortwind({
  // shortwind options
})({
  // existing Next config
})
```

## Behavior

- Adds a Webpack loader that transforms `.tsx`/`.ts`/`.jsx`/`.js` files via `@shortwind/core`.
- Adds the Turbopack equivalent for `next dev --turbo`.
- Registers `@shortwind/tailwind` in the Tailwind pipeline.
- File watcher for `./recipes/` in dev; re-runs `SKILL.md` generation on change.

## Tests (light)

- Smoke: minimal Next 15 app with `@card`. `next build` succeeds, output HTML/JS contains expanded classes.
- App router and Pages router both work.

## Out of scope

- React Server Components-specific handling beyond standard JSX transform (the expander only touches className literals — works in both client and server components).
