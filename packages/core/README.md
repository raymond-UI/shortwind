# @shortwind/core

The Shortwind engine: parser, resolver, and `expand()`. Zero Tailwind dependency, zero Node built-ins — pure functions over plain data. Used by every other Shortwind package.

> You usually don't install this directly — it arrives transitively via the bundler adapters. Install it only if you're building tooling on top of Shortwind.

## API

```ts
import { parseRecipeFile, buildRegistry, expand, renderSkillMarkdown } from "@shortwind/core";

const parsed = parseRecipeFile(cssSource, "card.css");        // syntax → RecipeAST
const registry = buildRegistry(parsed.ok ? parsed.value.recipes : []); // resolve refs/cycles
const html = expand(`<div class="@card">`, registry.value);  // expand @recipe tokens
```

Three stages, each consuming the prior: `parse → resolve → expand`. `parse`/`resolve` return `{ ok, value } | { ok, errors }` — throwing is reserved for bugs.

Docs: <https://shortwind.dev>
