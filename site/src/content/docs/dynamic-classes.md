---
title: Dynamic classes
description: Why @recipe only expands in literal class attributes — and how to bind one at runtime.
order: 3.5
---

# Dynamic classes

Shortwind expands recipes by statically scanning your source for **literal**
`class="..."` / `className="..."` strings and rewriting the `@recipe` tokens in
place — before the value is ever evaluated. That keeps it fast and framework-
agnostic, but it means anything that isn't a literal string in the source is
invisible to the build:

```astro
<!-- ✅ expands -->
<div class="@card-elevated p-6">…</div>

<!-- ❌ ships a dead `@nav-link` token — the element renders unstyled -->
<a class={active ? "@nav-link-active" : "@nav-link"}>Home</a>
<a class:list={[active ? "@nav-link-active" : "@nav-link"]}>Home</a>
<span class={`@badge-success`}>shipped</span>

<!-- ❌ recipe passed as a prop is just a string variable inside the component -->
<Icon class="@icon-sm" />
```

An unexpanded `@recipe` is a class name the browser doesn't know, so the element
simply renders without those styles — no error, just missing CSS. The build
warns when it can see the stranded token in a `class` / `className` / `class:list`
value (`[shortwind] … unexpanded recipe @nav-link …`). It can't warn when the
recipe reaches the attribute indirectly — assigned to a variable first, or passed
in as a component prop — so don't rely on the warning alone.

## `.astro` vs `.tsx`

The JSX transform that handles `.tsx` islands *can* see into a `className={…}`
ternary and expand both string operands; the HTML-shaped transform that handles
`.astro` (and `.vue`, `.svelte`) cannot. So the same conditional behaves
differently depending on which file it lives in — moving a snippet from a page
into an island can change whether it renders styled. Don't rely on the JSX
leniency; write for the literal-only rule everywhere and it works in both.

## The fix: expand at build time, bind the result

When you genuinely need to pick between recipes at runtime, resolve them to
plain Tailwind at build time and bind *that* string. Drop a tiny `rc()` helper
into your project once:

```ts
// src/lib/rc.ts — runs at build time only
import { parseRecipeFile, buildRegistry, expandClassList } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";

// Read the recipe families this project owns (scaffolded by `shortwind init`).
const sources = import.meta.glob("../../recipes/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const recipes: Recipe[] = [];
for (const [path, source] of Object.entries(sources)) {
  const name = path.split("/").pop()!.replace(/\.css$/, "");
  const parsed = parseRecipeFile(source, `${name}.css`);
  if (parsed.ok) recipes.push(...parsed.value.recipes);
}

const built = buildRegistry(recipes);
const registry: Registry = built.ok ? built.value : { families: {}, flattened: {} };

// Resolve a recipe class list to its raw Tailwind. The `true` enables the
// last-wins conflict merge, same as a static `class="@recipe"` attribute.
export function rc(classList: string): string {
  return expandClassList(classList, registry, true);
}
```

Then bind the expanded value — the build only ever sees plain Tailwind:

```astro
---
import { rc } from "../lib/rc";
---
<a class={isActive(href) ? rc("@nav-link-active") : rc("@nav-link")}>Home</a>
```

`import.meta.glob` is a Vite feature, so this works as-is in Astro and any
Vite-based setup. On other bundlers, load the same `recipes/*.css` with whatever
glob-import they provide — `parseRecipeFile` → `buildRegistry` → `expandClassList`
is the same three-step pipeline your build already runs.

## When you don't need `rc()`

- **Static class lists** — just write them literally. `class="@card p-6"` is the
  whole feature; no helper required.
- **A handful of fixed variants** — give each its own literal attribute and pick
  the element, not the string: render the `@nav-link-active` branch or the
  `@nav-link` branch as separate literal `class="..."` nodes.

Reach for `rc()` only when the class genuinely has to be computed in an
expression.
