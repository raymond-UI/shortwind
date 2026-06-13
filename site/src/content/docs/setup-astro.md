---
title: "Setup: Astro"
description: End-to-end Shortwind setup for an Astro project — integration wiring, the .astro expression gotcha, verify.
order: 1.3
---

# Setup: Astro

End-to-end walkthrough for an Astro project. `shortwind init` automates most
of it; every step below shows the exact result so you can pre-write the
config, audit what `init` did, or do it by hand.

## 1. Scaffold

```bash
npm create astro@latest my-app
cd my-app
```

React islands are optional — Shortwind expands recipes in `.astro` templates
and `.tsx` islands alike (with one rule difference; see step 7).

## 2. Tailwind v4 (prerequisite)

Astro uses Tailwind v4 through the Vite plugin:

```bash
npm install tailwindcss @tailwindcss/vite
```

```css
/* src/styles/global.css — the Tailwind entry */
@import "tailwindcss";
```

```ts
// astro.config.mjs — Tailwind goes in vite.plugins (it is not an integration)
export default defineConfig({
  vite: { plugins: [tailwindcss()] },
});
```

Import the CSS once in your base layout
(`import "../styles/global.css";` in `src/layouts/Layout.astro`).

## 3. Install Shortwind

```bash
npx @shortwind/cli@beta init --yes
```

This installs `@shortwind/astro`, writes `shortwind.config.json`, copies the
recipe catalog into `recipes/`, scaffolds the theme tokens (step 5), prints
the config snippet (step 4), and generates `skills/shortwind/SKILL.md` for
your coding agents.

## 4. The config edit

`init` does not patch `astro.config` automatically — it prints the snippet.
The full result, with Tailwind from step 2:

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import shortwind from "@shortwind/astro";

export default defineConfig({
  integrations: [react(), shortwind({ strict: true })],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Notes:

- `shortwind` is the **default** export of `@shortwind/astro`, and it's an
  **integration** — it goes in `integrations`, not `vite.plugins`. Under the
  hood it composes the `@shortwind/vite` plugin into Astro's Vite config for
  you.
- Order within `integrations` doesn't matter; the underlying Vite plugin is
  `enforce: "pre"`, so it runs before Tailwind's scan either way.
- `strict: true` fails the build when a known recipe token survives
  unexpanded anywhere in transformed output (recommended; drop it to demote
  leaks to warnings). The `rc()` pattern in step 7 stays exempt.

## 5. Theme tokens

The recipe catalog is authored against semantic color tokens (`bg-card`,
`text-muted-foreground`, `border-border`, …). On a fresh project `init`
appends this block to your Tailwind entry CSS (step 2's `global.css`);
recipes referencing an undefined token render colorless. The full default
block:

```css
/* shortwind:theme — default tokens for the recipe catalog. Edit freely. */
@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
/* end shortwind theme */
```

If your CSS already defines an `@theme` block or a `--background` token,
`init` keeps it intact and appends a marked `shortwind:theme-supplement`
block defining *only* the tokens your theme lacks, using the placeholder
values above — purely additive, nothing you defined is overridden. Tune the
placeholders to your palette.

`init` also appends a `shortwind:tones` block — the `[data-tone="…"]` table that
lets `@badge` and other tone-aware recipes take their color from data. See
[Tones](/docs/tones). (In `.astro`, set `data-tone` in a literal `class="@badge"`
element; dynamic tone selection lives in a `.tsx` island.)

## 6. How recipes reach Tailwind

The integration rewrites `@recipe` tokens to plain Tailwind utilities in
transformed source, but Tailwind's content scanner reads files **on disk** —
it never sees that output. So the underlying Vite plugin also hands Tailwind
the bounded set of utilities every installed recipe can expand to, via
`@source inline(...)`, Tailwind's official safelist primitive. It's injected
in-memory into the CSS pipeline; nothing is written to your files. JIT still
applies — only utilities recipes actually contain are candidates.

## 7. The dynamic-class rule — sharper in `.astro` files

A recipe only expands when it appears as a **literal string the build can
see in a class value** — and in `.astro` templates that means a plain
`class="..."` attribute string only:

```astro
<!-- ✅ expands -->
<div class="@card-elevated p-6">…</div>

<!-- ❌ ships dead tokens in .astro (the same ternary WOULD expand in a .tsx island) -->
<a class={active ? "@nav-link-active" : "@nav-link"}>Home</a>
<a class:list={[active ? "@nav-link-active" : "@nav-link"]}>Home</a>
```

For runtime selection, expand first and bind the result, via a tiny `rc()`
helper over the plugin's virtual registry module:

```ts
// src/lib/rc.ts
import { expandClassList } from "@shortwind/astro";
import registry from "virtual:shortwind/registry";

export const rc = (classList: string): string => expandClassList(classList, registry, true);
```

```astro
---
import { rc } from "../lib/rc";
---
<a class={isActive(href) ? rc("@nav-link-active") : rc("@nav-link")}>Home</a>
```

For the virtual module's types add
`/// <reference types="@shortwind/astro/client" />` to `src/env.d.ts`. Full
rules and patterns: [dynamic classes](/docs/dynamic-classes).

## 8. Did it work?

1. `npm run dev` and put `<div class="@card-elevated p-6">hello</div>` in a
   page — it should render as a bordered, shadowed card, and the element in
   the inspector should show expanded Tailwind classes, no `@` token.
2. After `npm run build`, run the transform-independent check:

```bash
npx shortwind doctor
```

It scans `dist/` for raw recipe tokens and tells you whether the integration
never ran (wiring problem — revisit step 4) or ran and specific tokens leaked
(usually a `class={expr}` from step 7). Clean output plus a styled render
means you're done. `npx shortwind lint` covers the source-side checks.

## 9. Gotchas

- **`class={expr}` and `class:list` don't expand in `.astro`** (step 7) —
  the single most-hit Astro pitfall. Use literal `class="..."` or `rc()`.
- **Integration missing entirely** presents as a green build with raw
  `@card` text in `dist/` HTML. `shortwind doctor` tells this apart from a
  leak.
- This very site is an Astro + Shortwind project — its
  [`astro.config.ts`](https://github.com/raymond-UI/shortwind/blob/main/site/astro.config.ts)
  is a working reference for the wiring above.
