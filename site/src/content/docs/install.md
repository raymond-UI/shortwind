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

## Theme tokens

The recipe catalog is authored against semantic color tokens — `bg-card`,
`text-muted-foreground`, `border-border`, `bg-primary`, and friends. On a fresh
project, `init` appends a default token block (the shadcn-style oklch palette,
mapped through `@theme inline`) to your Tailwind CSS entry so every recipe
renders with color on first run.

If your CSS **already contains an `@theme` block or `--background` token**
(create-next-app ships one), `init` leaves your theme untouched — and then
checks whether the tokens the installed recipes reference are actually defined.
Any missing names are listed in a warning like:

```
Your existing theme (app/globals.css) does not define 12 design tokens the
installed recipes use:

  accent, border, card, card-foreground, destructive, input, muted,
  muted-foreground, primary, primary-foreground, ring, secondary
```

Recipes referencing a missing token render colorless. Fix it by defining each
listed token in your theme — either as a Tailwind v4 theme key
(`--color-card: …` inside `@theme`) or shadcn-style (`--card: …` in `:root`
plus `--color-card: var(--card)` in `@theme inline`).

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
