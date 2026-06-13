---
title: Install
description: Run @shortwind/cli init and wire it into your bundler.
order: 1
---

# Install

```bash
npx @shortwind/cli@beta init        # interactive (prompts for a preset)
npx @shortwind/cli@beta init --yes  # non-interactive: default preset, no prompts
```

Per-framework walkthroughs with every snippet shown in full —
[Vite](/docs/setup-vite) · [Next.js](/docs/setup-next) ·
[Astro](/docs/setup-astro). This page covers what `init` does in general;
the guides are the copy-pasteable end-to-end path.

Shortwind's CLI is the **`@shortwind/cli`** package — it provides the `shortwind`
command. It's in beta, so install with the `@beta` tag (or `npm i -D @shortwind/cli@beta`
to use the `shortwind` command directly in your scripts). In CI or agent
sessions, pass `--yes`/`-y` (default preset, `starter`) or `--preset <name>`
so `init` never blocks on a prompt.

`init` detects your bundler and does the whole setup:

1. Detect your bundler (Vite, Next.js, Astro, or a Tailwind project) and install the matching adapter — `@shortwind/vite`, `@shortwind/next`, or `@shortwind/astro`. (`@shortwind/core` comes along transitively; you never install it directly.)
2. Write `shortwind.config.json` at the repo root.
3. Copy the recipe catalog into a `recipes/` directory — yours to edit.
4. Scaffold a default theme so recipes render with color on first run.
5. Wire the plugin: on Vite, `init` patches `vite.config.*` automatically; on Next.js and Astro it prints the one-line snippet to paste into your config — the same snippets are shown in full in the [Next.js](/docs/setup-next#3-the-config-edit) and [Astro](/docs/setup-astro#4-the-config-edit) guides, so you can pre-write the config without running anything.
6. Generate `skills/shortwind/SKILL.md` — a recipe palette your coding agents can read.

## Theme tokens

The recipe catalog is authored against semantic color tokens — `bg-card`,
`text-muted-foreground`, `border-border`, `bg-primary`, and friends. On a fresh
project, `init` appends a default token block (the shadcn-style oklch palette,
mapped through `@theme inline`) to your Tailwind CSS entry so every recipe
renders with color on first run.

If your CSS **already contains an `@theme` block or `--background` token**
(create-next-app ships one), `init` keeps your theme intact — and then checks
whether the tokens the installed recipes reference are actually defined.
Recipes referencing an undefined token render colorless, so `init` appends a
marked supplement block at the end of the file defining *only the missing
ones* with neutral placeholder values:

```css
/* shortwind:theme-supplement — placeholder values for tokens your theme didn't define. Tune them to your palette. */
:root {
  --card: oklch(1 0 0);
  --border: oklch(0.922 0 0);
  /* …only the tokens you were missing */
}
@theme inline {
  --color-card: var(--card);
  --color-border: var(--border);
}
```

The supplement is purely additive — nothing you defined is ever overridden —
and the dark values follow your project's own strategy (a `.dark` class or
the `prefers-color-scheme` media query; with neither, the `:root` values
apply everywhere). Re-running `init` finds nothing missing and changes
nothing. Tune the placeholder values to your palette, or move them into your
own theme blocks; the values come from the default block below.

This is the full default block `init` writes (also the reference for the
values to merge into an existing theme):

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

## Tones

Alongside the theme, `init` appends a `shortwind:tones` block — a small
`[data-tone="…"]` table that powers tone-aware recipes like `@badge`. It's what
lets a badge's color come from your data (`data-tone={severity}`) without a
dynamic class name. Like the theme block it's append-only, idempotent, and yours
to edit or extend. See [Tones](/docs/tones).

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
