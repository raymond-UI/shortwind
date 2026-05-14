---
title: Composition & conflicts
description: How @references and tailwind-merge interact.
order: 3
---

# Composition & conflicts

When a recipe references another recipe, Shortwind flattens the tokens in
order. Later tokens win — that's the same rule Tailwind uses.

```css
@recipe card { rounded-lg border bg-white p-4 }
@recipe card-tight { @card p-2 }
```

`@card-tight` expands to `rounded-lg border bg-white p-2`. The `p-4` from
`@card` is shadowed by the `p-2` that came after it.

## tailwind-merge

Shortwind runs the flattened token list through
[`tailwind-merge`](https://github.com/dcastil/tailwind-merge) before emitting
HTML. That handles the gnarly cases — `bg-red-500 bg-blue-500` collapses to
`bg-blue-500`, variants are respected, arbitrary values too.

## Cycles and duplicates

Recipe resolution is a two-pass DAG walk. The resolver catches:

- Cycles (`@a` → `@b` → `@a`).
- Unknown references.
- Duplicate recipe names across files.

Each is reported as a structured diagnostic with file + line. The CLI's
`shortwind lint` surfaces them.
