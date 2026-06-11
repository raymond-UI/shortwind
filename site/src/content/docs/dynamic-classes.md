---
title: Dynamic classes
description: Why @recipe only expands in literal class attributes — and how to bind one at runtime.
order: 3.5
---

# Dynamic classes

Shortwind expands recipes by rewriting `@recipe` tokens it can statically see
in your source — before the value is ever evaluated. The rule: **the recipe
text must appear as a literal string the build can see in a `class`/`className`
attribute.** What counts as visible depends on the file type.

**In JSX/TSX (`.tsx`, `.jsx`, `.mdx`)** the transform parses the
`className={…}` expression, so literal strings inside it expand — including
both branches of a ternary, strings inside `clsx(...)`-style call arguments,
and the static parts of template literals:

```tsx
<div className="@card-elevated p-6">…</div>              {/* ✅ expands */}
<a className={active ? "@tab-active" : "@tab"}>Home</a>   {/* ✅ expands */}
<button className={clsx("@btn-primary", on && "@btn-ghost")} /> {/* ✅ both expand */}
```

**In HTML-shaped templates (`.astro`, `.vue`, `.svelte`, `.html`)** only plain
`class="..."` attribute strings expand. A `class={…}` JS expression — including
the exact ternary that works in a `.tsx` island — and Astro's `class:list` do
**not**:

```astro
<!-- ✅ expands -->
<div class="@card-elevated p-6">…</div>

<!-- ❌ ships dead tokens in .astro (would expand in .tsx) -->
<a class={active ? "@nav-link-active" : "@nav-link"}>Home</a>
<a class:list={[active ? "@nav-link-active" : "@nav-link"]}>Home</a>
```

**In every mode, the silent failure is indirection.** A recipe that reaches the
attribute as a *value* — assigned to a variable first, passed as a component
prop, looked up from an object, or composed into a string — is invisible to the
build, ships as a dead token, and produces **no warning**:

```tsx
const cfg = { recipe: "@badge-success" };
<span className={cfg.recipe}>shipped</span>   // ❌ silent — no expansion, no warning
<Icon class="@icon-sm" />                      // ❌ silent — a prop is just a string
```

An unexpanded `@recipe` is a class name the browser doesn't know, so the element
simply renders without those styles — no error, just missing CSS. The build
warns when it can see the stranded token in a `class` / `className` / `class:list`
value (`[shortwind] … unexpanded recipe @nav-link …`). It cannot warn about the
indirect cases above, so don't rely on the warning alone.

Because the same conditional behaves differently in `.astro` and `.tsx`, moving
a snippet between them can change whether it renders styled. Don't lean on the
JSX leniency: write for the literal-only rule everywhere and it works in both.

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

## Catching leaks: strict mode

The default build *warns* when it can see a stranded token in a class value,
and stays silent on the indirect cases. Every adapter also takes a
`strict: true` option that scans the **entire transformed output** for known
recipe tokens — catching the variable/prop indirection case too — and **fails
the build** instead of shipping unstyled UI:

```ts
// vite.config.ts
shortwind({ strict: true })

// next.config.ts
export default withShortwind({ strict: true })(nextConfig);

// astro.config.ts
integrations: [shortwind({ strict: true })]
```

Strict mode is opt-in because the detector is token-based: a file that
legitimately *names* a recipe in prose (a docs page, a comment) would fail the
build. For app code, turn it on — a leak the default warning can't see is
exactly the one you want to fail loudly.

## When you don't need `rc()`

- **Static class lists** — just write them literally. `class="@card p-6"` is the
  whole feature; no helper required.
- **A handful of fixed variants** — give each its own literal attribute and pick
  the element, not the string: render the `@nav-link-active` branch or the
  `@nav-link` branch as separate literal `class="..."` nodes.

Reach for `rc()` only when the class genuinely has to be computed in an
expression.
