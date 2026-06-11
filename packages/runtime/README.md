# @shortwind/runtime

Browser/CDN runtime expander for [Shortwind](https://shortwind.dev). Walks the DOM, expands `@recipe` tokens before first paint, and ships the default catalog inline (~6KB gzipped). For standalone HTML artifacts with **no build step**.

> Bundler projects don't need this — they expand recipes at build time via `@shortwind/vite` / `@shortwind/next` / `@shortwind/astro`. This is the zero-build path.

## CDN (no install)

```html
<script src="https://shortwind.dev/expand.js"></script>
<div class="@card-elevated @stack-md">…</div>
```

## Programmatic

```ts
import { autostart, install } from "@shortwind/runtime";

autostart();        // expand the DOM now, ship the bundled catalog
// or: install(window) for manual control
```

> **Divergence from the build-time path:** to stay within the ~8KB budget, the
> CDN runtime expands `@recipe` tokens but does **not** run `tailwind-merge`. So
> conflicting utilities are left as-is (`@card p-2` ships `… p-4 p-2`, last one
> wins per the CSS cascade) rather than deduped to `p-2` the way the build-time
> adapters do. Recipe expansion itself is identical; only the conflict-merge
> step is omitted — use a bundler adapter if you need merged output.

Docs: <https://shortwind.dev>
