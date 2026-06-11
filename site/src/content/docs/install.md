---
title: Install
description: Run @shortwind/cli init and wire it into your bundler.
order: 1
---

# Install

```bash
npx @shortwind/cli@beta init
```

Shortwind's CLI is the **`@shortwind/cli`** package — it provides the `shortwind`
command. It's in beta, so install with the `@beta` tag (or `npm i -D @shortwind/cli@beta`
to use the `shortwind` command directly in your scripts).

`init` detects your bundler and does the whole setup:

1. Detect your bundler (Vite, Next.js, Astro, or a Tailwind project) and install the matching adapter — `@shortwind/vite`, `@shortwind/next`, or `@shortwind/astro`. (`@shortwind/core` comes along transitively; you never install it directly.)
2. Write `shortwind.config.json` at the repo root.
3. Copy the recipe catalog into a `recipes/` directory — yours to edit.
4. Scaffold a default theme so recipes render with color on first run.
5. Patch your bundler config with the right plugin import.
6. Generate `skills/shortwind/SKILL.md` — a recipe palette your coding agents can read.

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
