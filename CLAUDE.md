# Architecture rules

## Dependency direction

```
cli ──┐
vite ─┼──► tailwind ──► core
next ─┤
astro ┘
registry ──► core
```

- `core` has zero workspace deps and zero Node built-ins. Pure functions over plain data.
- Adapters (`cli`, `vite`, `next`, `astro`, `tailwind`, `registry`) do IO. Core does not.
- Arrows never reverse. Tailwind never imports a plugin. Core never imports anything.

## Three layers, never collapsed

1. `parse(source) → RecipeAST` — syntax only.
2. `resolve(asts) → Registry` — cycles, duplicates, unknown refs.
3. `expand(input, registry) → string` — uses `tailwind-merge`.

Each stage consumes the prior stage's output. Lint and build share stage 2. No duplicate logic.

## Boundaries

- All cross-package values are plain serializable data. No class instances or closures in public types.
- Types live in `packages/core/src/types.ts`. Other packages import, never redefine.
- `parse` and `resolve` return `{ ok: true, value } | { ok: false, errors: Diagnostic[] }`. Throwing is reserved for bugs.

## Tests

- Every behavior is a golden fixture: `fixtures/<name>/input` + `fixtures/<name>/expected`.
- Refactors must keep fixtures byte-identical.
- Heavy coverage: `core`, `cli`. Light: plugins, adapters.
- Follow TDD

## Config

- One config file: `shortwind.config.json`. No JS config, no plugin hooks until a real user asks.

## Versioning

- Recipe family versions, `expand@<version>.js`, lockfile shas are mandatory and machine-checked. Not editorial.

