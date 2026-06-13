---
title: "Setup: Vite"
description: End-to-end Shortwind setup for a Vite project — scaffold, wire, verify.
order: 1.1
---

# Setup: Vite

End-to-end walkthrough for a Vite project. `shortwind init` automates most of
it; every step below shows the exact result so you can pre-write the config,
audit what `init` did, or do it by hand.

## 1. Scaffold

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app && npm install
```

Any template works — Shortwind expands recipes in `.html`, `.jsx`/`.tsx`,
`.vue`, `.svelte`, and `.astro` sources.

## 2. Tailwind v4 (prerequisite)

Shortwind sits in front of Tailwind v4. If the project doesn't have it yet:

```bash
npm install tailwindcss @tailwindcss/vite
```

```css
/* src/index.css — the Tailwind entry */
@import "tailwindcss";
```

## 3. Install Shortwind

```bash
npx @shortwind/cli@beta init --yes
```

This installs `@shortwind/vite`, writes `shortwind.config.json`, copies the
recipe catalog into `recipes/`, scaffolds the theme tokens (step 5), patches
`vite.config.ts` (step 4), and generates `skills/shortwind/SKILL.md` for your
coding agents. The rest of this page is what each of those steps produces.

## 4. The config edit

On Vite, `init` patches the config automatically. The result:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { shortwind } from "@shortwind/vite";

export default defineConfig({
  plugins: [shortwind({ strict: true }), tailwindcss(), react()],
});
```

Notes:

- `shortwind` is a **named** export from `@shortwind/vite`.
- The plugin sets `enforce: "pre"`, so it runs before Tailwind's scan
  regardless of its position in the array — first is just convention.
- `strict: true` fails the build when a known recipe token survives
  unexpanded anywhere in transformed output (recommended; drop it to demote
  leaks to warnings). The `rc()` pattern in step 7 stays exempt.

## 5. Theme tokens

The recipe catalog is authored against semantic color tokens (`bg-card`,
`text-muted-foreground`, `border-border`, …). On a fresh project `init`
appends this block to your Tailwind entry CSS; recipes referencing an
undefined token render colorless. The full default block:

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
[Tones](/docs/tones).

## 6. How recipes reach Tailwind

The plugin rewrites `@recipe` tokens to plain Tailwind utilities in
transformed source, but Tailwind's content scanner reads files **on disk** —
it never sees that output. So the plugin also hands Tailwind the bounded set
of utilities every installed recipe can expand to, via `@source inline(...)`,
Tailwind's official safelist primitive. On Vite this is injected in-memory
into the CSS pipeline; nothing is written to your files. JIT still applies —
only utilities that recipes actually contain are candidates.

## 7. The dynamic-class rule

A recipe only expands when it appears as a **literal string in a
`class`/`className` value**. A recipe that reaches the attribute through a
variable, prop, or computed string ships as a dead token — silently. For
runtime selection, expand first and bind the result with a tiny `rc()`
helper over `virtual:shortwind/registry`:

```ts
// src/lib/rc.ts
import { expandClassList } from "@shortwind/vite";
import registry from "virtual:shortwind/registry";

export const rc = (classList: string): string => expandClassList(classList, registry, true);
```

For the virtual module's types add `/// <reference types="@shortwind/vite/client" />`
to `src/vite-env.d.ts`. Full rules and patterns: [dynamic classes](/docs/dynamic-classes).

## 8. Did it work?

1. `npm run dev` and put `<div className="@card-elevated p-6">hello</div>` in
   a component — it should render as a bordered, shadowed card, and the DOM
   inspector should show expanded Tailwind classes, no `@` token.
2. After `npm run build`, run the transform-independent check:

```bash
npx shortwind doctor
```

It scans `dist/` for raw recipe tokens and tells you whether the plugin never
ran (wiring problem — revisit step 4) or ran and specific tokens leaked
(usually the dynamic-class rule — step 7). Clean output plus a styled render
means you're done. `npx shortwind lint` covers the source-side checks.

## 9. Gotchas

- **Plugin missing entirely** presents as a green build with raw `@card`
  text in the page. `shortwind doctor` (step 8) tells this apart from a leak.
- **Tailwind utilities look dead** only for classes that exist solely inside
  recipe bodies — that's the `@source inline` mechanism (step 6) not running,
  which means the plugin isn't wired.
- Editing `recipes/*.css` invalidates and re-expands automatically in dev;
  run `npx shortwind build` to refresh `SKILL.md` after editing, or
  `npx shortwind dev` to watch.
