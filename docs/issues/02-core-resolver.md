# @shortwind/core — registry resolver

## Scope

Given a `Recipe[]` from the parser, build a `Registry` — a lookup table from recipe name to its **fully flattened** class list (all `@references` resolved transitively).

## Contract

```
buildRegistry(recipes: Recipe[]) → Registry
```

`Registry` exposes:
- `get(name: string) → string[]` — fully flattened class list, or undefined if unknown
- `has(name: string) → boolean`
- `names() → string[]` — every defined recipe name
- `families() → Map<family, Recipe[]>` — recipes grouped by file (family)

## Requirements

- Topological resolution. A recipe that references `@card` resolves `@card`'s body first.
- Arbitrary depth allowed.
- Cycles are a hard error. Thrown with the cycle path (e.g. `card-elevated → fancy-card → card-elevated`).
- Unknown references are a hard error at registry build time, **not** at expand time. Better to fail loud during `shortwind build` than to silently leak `@nope` to the browser.
- Duplicate recipe names across files: error, listing both source files and line numbers.

## Tests (heavy)

- Simple registry, no references.
- One recipe references another.
- Three-level chain.
- Diamond reference (A → B, A → C, B → D, C → D).
- Self-reference → error.
- 2-cycle → error.
- N-cycle → error with full path.
- Reference to unknown recipe → error.
- Duplicate name → error.
- Recipe with zero tokens.
- The flattened list preserves source order semantics required by `tailwind-merge`.

## Out of scope

No HTML/JSX parsing. No tailwind-merge. Just registry construction.
