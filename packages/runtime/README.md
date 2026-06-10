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

Same parser/resolver/`tailwind-merge` semantics as the build-time path — byte-identical class output.

Docs: <https://shortwind.dev>
