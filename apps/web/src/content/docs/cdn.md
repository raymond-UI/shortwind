---
title: CDN expander
description: Drop-in script for standalone HTML artifacts.
order: 7
---

# CDN expander

For one-off HTML files — Claude artifacts, demos, single-page experiments —
load the CDN expander and skip the bundler step:

```html
<script src="https://shortwind.dev/expand.js" defer></script>
```

On `DOMContentLoaded` the script walks the document, expands every `@recipe`
in every `class` attribute, and stops. No mutation observer, no overhead
after the first paint.

## What ships in `expand.js`

- The Shortwind expander (~1KB gzipped).
- The default catalog — 100+ recipes, ~5KB gzipped.
- Total: ~6KB gzipped. The build fails CI if it exceeds 8KB.

## Custom registries

For a custom palette, point the script at a manifest:

```html
<script
  src="https://shortwind.dev/expand.js"
  data-registry="https://my-registry.example/manifest.json"
  defer
></script>
```

The runtime fetches the manifest, builds a registry, then walks the DOM.
Hides body content with an inline style shim until expansion completes to
avoid FOUC.

## When NOT to use the CDN

If you're shipping a real site, use the bundler plugin. It runs at build time,
strips `@recipe` tokens from your source, and ships zero runtime overhead.
