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
plain Tailwind and bind *that* string. Drop a tiny `rc()` helper into your
project once. Everything it needs ships with the adapter `init` installed —
you never import `@shortwind/core` directly (it's a transitive dependency and
won't resolve from your project).

### Vite and Astro

The plugin serves your resolved catalog as a virtual module,
`virtual:shortwind/registry`. It contains only the *flattened* registry —
plain Tailwind utilities — so importing it never plants `@recipe` tokens in
your client bundle:

```ts
// src/lib/rc.ts
import { expandClassList } from "@shortwind/vite"; // Astro: "@shortwind/astro"
import registry from "virtual:shortwind/registry";

// Resolve a recipe class list to its raw Tailwind. The `true` enables the
// last-wins conflict merge, same as a static `class="@recipe"` attribute.
export function rc(classList: string): string {
  return expandClassList(classList, registry, true);
}
```

For the virtual module's types, add one line to `src/vite-env.d.ts`
(Astro: `src/env.d.ts`):

```ts
/// <reference types="@shortwind/vite/client" />
```

(Astro projects reference `@shortwind/astro/client` instead.)

Then bind the expanded value — the build only ever sees plain Tailwind:

```astro
---
import { rc } from "../lib/rc";
---
<a class={isActive(href) ? rc("@nav-link-active") : rc("@nav-link")}>Home</a>
```

### Next.js

The recipe catalog lives on disk, so build the registry server-side and pass
expanded strings to client components as props:

```ts
// lib/rc.ts — import from server components / route handlers only
import path from "node:path";
import { expandClassList, loadRegistryFromDir } from "@shortwind/next";

const registry = loadRegistryFromDir(path.join(process.cwd(), "recipes"));

export function rc(classList: string): string {
  return expandClassList(classList, registry, true);
}
```

### Don't glob the recipe sources into the client

An older version of this page suggested `import.meta.glob("…/recipes/*.css",
{ query: "?raw" })`. Don't — that inlines the raw recipe *sources*, including
their `@recipe` definition tokens and cross-references, into the client
bundle. Those are exactly the tokens the build exists to eliminate, and they
fail the no-leftover-`@recipe` check. The virtual module (or the server-side
load in Next) gives you the same registry with none of the leakage.

## When you don't need `rc()`

- **Static class lists** — just write them literally. `class="@card p-6"` is the
  whole feature; no helper required.
- **A handful of fixed variants** — give each its own literal attribute and pick
  the element, not the string: render the `@nav-link-active` branch or the
  `@nav-link` branch as separate literal `class="..."` nodes.

Reach for `rc()` only when the class genuinely has to be computed in an
expression.
