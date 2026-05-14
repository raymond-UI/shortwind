# @shortwind/core — expander

## Scope

Substitute `@recipes` with their flattened class lists inside `class="..."` / `className="..."` attributes and JSX expressions, then run the result through `tailwind-merge` for last-position-wins conflict resolution.

## Contract

```
expand(input: string, registry: Registry, options?) → string
```

Options:
- `mode`: `'html'` (default — matches `class="..."`) | `'jsx'` (matches `className="..."`, `className={'...'}`, simple ternary literals).
- `mergeConflicts`: boolean (default `true`) — pass through `tailwind-merge`.

A second entry point for DOM transformation (used by the runtime CDN expander):

```
expandDOM(root: Element, registry: Registry) → void
```

Walks the DOM, rewrites every element's `class` attribute, then idempotent.

## Requirements

- Literal string portions of JSX template literals are expanded. Computed portions (`${variant}`) are left untouched, with a debug log.
- Unknown `@recipes` are left untouched (visible at view-source, fails loud).
- Recipes and raw utilities compose freely: `class="@card p-8"` → expansion of `@card` + `p-8`, then `tailwind-merge`.
- Multiple recipes on one element: `class="@card @stack-md"` → both expanded in order.
- `tailwind-merge` is configured to know about Tailwind theme tokens used in the default catalog. Custom tokens are merged sensibly.
- DOM expander is idempotent: running it twice does not double-expand or corrupt output.

## Tests (heavy)

- Single recipe in `class=""`.
- Multiple recipes.
- Recipe + raw utility, last-position-wins applied.
- `@card-elevated` (which references `@card`) expanded correctly via the resolver.
- Unknown recipe passes through.
- JSX mode: `className="@card"`.
- JSX mode: `className={\`@card ${extra}\`}` — literal part expanded, computed part preserved.
- JSX mode: ternary with literal recipes on both branches.
- DOM mode: walk + rewrite, idempotent on second pass.
- Conflicts: `class="@card p-6"` where `@card` has `p-4` → final has `p-6`.
- Family overlap: `class="@card @card-elevated"` → both expand, `tailwind-merge` produces a defined (last-wins) result. Lint warns separately (not this module's concern).

## Out of scope

- Lint rules (separate module).
- JSX parsing of dynamic-only class expressions (we deliberately don't try).
- Watching files for changes (CLI's job).
