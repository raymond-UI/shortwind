---
title: Install
description: Run shortwind init and wire it into your bundler.
order: 1
---

# Install

```bash
npx shortwind init
```

`init` is interactive. It will:

1. Detect your bundler (Vite, Next.js, Astro, or a Tailwind project).
2. Write `shortwind.config.json` at the repo root.
3. Create a `recipes/` directory with starter recipes.
4. Generate `SKILL.md` — a recipe palette your coding agents can read.
5. Patch your bundler config with the right plugin import.

## What the plugin does

The plugin scans your source files for `class="..."` and `className="..."`
attributes, expands any `@recipe` shorthands into Tailwind tokens, and hands
the result to Tailwind's content scanner. From Tailwind's perspective, your
source files contain plain Tailwind classes — no Shortwind awareness needed.

## What if I'm not using a bundler?

Drop the CDN expander into any HTML page:

```html
<script src="https://shortwind.dev/expand.js" defer></script>
```

It walks the DOM on `DOMContentLoaded` and rewrites class attributes in
place. See [cdn](/docs/cdn).
