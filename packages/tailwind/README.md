# @shortwind/tailwind

The Tailwind integration layer for [Shortwind](https://shortwind.dev): the `@recipe` → utilities transform, the `@source inline(...)` injection, and Tailwind v3/v4 detection.

> You usually don't install this directly — it's a dependency of the bundler adapters (`@shortwind/vite`, `@shortwind/next`, `@shortwind/astro`), which `npx @shortwind/cli@beta init` sets up for you.

## Direct use

```ts
import { transformContent, loadRegistryFromDir, findUnexpandedRecipes } from "@shortwind/tailwind";

const registry = loadRegistryFromDir("./recipes");
const out = transformContent(source, registry, { mode: "jsx" }); // or "html"
const leftover = findUnexpandedRecipes(out, registry); // recipes the transform couldn't reach
```

Pairs with `@shortwind/core` (the parser/resolver/expander).

Docs: <https://shortwind.dev>
