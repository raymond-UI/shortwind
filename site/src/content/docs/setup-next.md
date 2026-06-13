---
title: "Setup: Next.js"
description: End-to-end Shortwind setup for Next.js App Router — Turbopack and webpack, root app/ or src/.
order: 1.2
---

# Setup: Next.js

End-to-end walkthrough for Next.js (App Router; Pages Router works the same
way). `shortwind init` automates most of it; every step below shows the exact
result so you can pre-write the config, audit what `init` did, or do it by
hand.

Works with **both bundlers**: Turbopack (the Next 16 default) and webpack.
`withShortwind` registers the loader for both — no flags needed.

## 1. Scaffold

```bash
npx create-next-app@latest my-app
cd my-app
```

`create-next-app` offers two layouts; Shortwind supports both:

- **root layout** — `app/`, `components/`, `lib/` at the project root, with
  the Tailwind entry at `app/globals.css`
- **`src/` layout** — everything under `src/`, entry at `src/app/globals.css`

Recent `create-next-app` already ships Tailwind v4 with
`@import "tailwindcss"` in `globals.css`; nothing to add there.

## 2. Install Shortwind

```bash
npx @shortwind/cli@beta init --yes
```

This installs `@shortwind/next`, writes `shortwind.config.json`, copies the
recipe catalog into `recipes/`, checks your theme (step 4), prints the config
snippet (step 3), and generates `skills/shortwind/SKILL.md` for your coding
agents.

## 3. The config edit

`init` does not patch `next.config` automatically — it prints the snippet.
This is the full edit:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withShortwind } from "@shortwind/next";

const nextConfig: NextConfig = {
  /* your existing options */
};

export default withShortwind({ strict: true })(nextConfig);
```

**`withShortwind` is curried** — it takes the Shortwind options and returns a
function you call with your Next config. `withShortwind(nextConfig)` is wrong
and silently does nothing for you.

`strict: true` fails the build when a known recipe token survives unexpanded
anywhere in transformed output (recommended; drop it to demote leaks to
warnings). The `rc()` pattern in step 6 stays exempt.

## 4. Theme tokens

The recipe catalog is authored against semantic color tokens (`bg-card`,
`text-muted-foreground`, `border-border`, …). `create-next-app`'s
`globals.css` already contains an `@theme` block, so `init` **keeps your
theme intact** and appends a marked `shortwind:theme-supplement` block at the
end of the file defining *only* the tokens your theme doesn't — typically
`border`, `card`, `muted-foreground`, `primary`, and friends. The supplement
is purely additive (nothing you defined is overridden), follows your
dark-mode strategy (a `.dark` class or the `prefers-color-scheme` media
query), and uses the neutral placeholder values below — **tune them to your
palette**. On a project with no theme at all, `init` writes this whole block
instead:

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

Recipes referencing a missing token render colorless — no error.

`init` also appends a `shortwind:tones` block here — the `[data-tone="…"]` table
that lets `@badge` and other tone-aware recipes take their color from data. See
[Tones](/docs/tones).

## 5. How recipes reach Tailwind

The loader rewrites `@recipe` tokens to plain Tailwind in transformed source,
but in Next, Tailwind v4 reads your entry CSS **from disk** and scans on-disk
sources — it never sees loader output. So Shortwind writes the bounded set of
utilities your recipes can expand to into `globals.css` as a
`@source inline(...)` directive, Tailwind's official safelist primitive. It's
synced every time `next.config` is evaluated (each `next dev` / `next build`)
and refreshed when recipes change mid-session. **The directive in your
`globals.css` is expected — commit it, don't delete it.** JIT still applies;
only utilities recipes actually contain become candidates.

## 6. The dynamic-class rule

A recipe only expands when it appears as a **literal string in a
`className` value**. A recipe that reaches the attribute through a variable,
prop, or object lookup ships as a dead token — silently. For runtime
selection, expand server-side and pass the result down. The catalog lives on
disk, so build the registry in server code:

```ts
// lib/rc.ts — import from server components / route handlers only
import path from "node:path";
import { expandClassList, loadRegistryFromDir } from "@shortwind/next";

const registry = loadRegistryFromDir(path.join(process.cwd(), "recipes"));

export const rc = (classList: string): string => expandClassList(classList, registry, true);
```

Full rules and patterns: [dynamic classes](/docs/dynamic-classes).

## 7. Did it work?

1. `npm run dev` and put `<div className="@card-elevated p-6">hello</div>` in
   `app/page.tsx` — it should render as a bordered, shadowed card, and the
   element in the inspector should show expanded Tailwind classes, no `@`
   token.
2. After `npm run build`, run the transform-independent check:

```bash
npx shortwind doctor
```

It scans `.next/` for raw recipe tokens and tells you whether the loader
never ran (wiring problem — revisit step 3) or ran and specific tokens
leaked (usually the dynamic-class rule — step 6). Clean output plus a styled
render means you're done. `npx shortwind lint` covers the source-side checks
(and understands the root `app/` layout).

## 8. Gotchas

- **Building before step 3 is finished** gives a *green* build that ships raw
  `@card` text in the prerendered HTML — there's no error, because nothing
  ran. Don't debug the loader; run `shortwind doctor`, which distinguishes
  "not wired" from "wired but leaking". `strict` can't catch this case
  either: it lives inside the loader, so it never fires if the loader was
  never registered.
- **Turbopack is the Next 16 default** and fully supported —
  `withShortwind` registers the loader rule for Turbopack and webpack alike.
  Don't switch bundlers to troubleshoot.
- **The `@source inline(...)` line appearing in `globals.css`** is the
  safelist mechanism from step 5, not a leak or corruption.
- `withShortwind` is curried (step 3) — the most common wiring mistake.
