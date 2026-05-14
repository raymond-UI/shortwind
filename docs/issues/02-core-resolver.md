# @shortwind/core — registry resolver

## Scope

Given a `Recipe[]` from the parser, build a `Registry` — a lookup table from recipe name to its **fully flattened** class list (all `@references` resolved transitively). Errors (cycles, unknown refs, duplicates) surface here, not at expand time.

## Contract

```ts
buildRegistry(recipes: Recipe[]) : Result<Registry, Diagnostic[]>
```

`Registry` (returned in `result.value`) exposes:

- `get(name: string) → string[] | undefined` — fully flattened class list, or `undefined` if unknown.
- `has(name: string) → boolean`
- `names() → string[]` — every defined recipe name.
- `families() → Map<family, Recipe[]>` — recipes grouped by file (family).

`Result`, `Diagnostic` are imported from `@shortwind/core` (defined in issue 01).

## Requirements

- Topological resolution. A recipe that references `@card` resolves `@card`'s body first.
- Arbitrary depth allowed.
- **Cycles** — a hard error returned as `{ ok: false, errors: [...] }`. Diagnostic code: `resolve/cycle`. Message includes the full cycle path (`card-elevated → fancy-card → card-elevated`).
- **Unknown references** — a hard error at registry build time, **not** at expand time. Better to fail loud during `shortwind build` than to silently leak `@nope` to the browser. Code: `resolve/unknown-reference`.
- **Duplicate recipe names** across files — a hard error listing both source files and line numbers. Code: `resolve/duplicate-name`.
- All applicable errors are collected before returning (resolver does not bail on the first cycle).
- Throwing is reserved for true bugs (e.g. a Recipe missing its `name` field — a contract violation from the parser).

## Tests (heavy)

- Simple registry, no references.
- One recipe references another.
- Three-level chain.
- Diamond reference (A → B, A → C, B → D, C → D).
- Self-reference → `{ ok: false, errors: [{ code: "resolve/cycle", ... }] }`.
- 2-cycle → cycle error with full path.
- N-cycle → cycle error with full path.
- Reference to unknown recipe → `resolve/unknown-reference` diagnostic.
- Duplicate name across files → `resolve/duplicate-name` diagnostic with both file paths.
- Recipe with zero tokens.
- Multiple independent errors in one input are all reported.
- The flattened list preserves source order semantics required by `tailwind-merge`.

## Out of scope

No HTML/JSX parsing. No tailwind-merge. Just registry construction.
