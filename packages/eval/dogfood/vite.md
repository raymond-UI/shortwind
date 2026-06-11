# Building with Shortwind — a candid retro

## What it is, and how the build went

Scaffolded Vite + React + TS, added Tailwind v4 via `@tailwindcss/vite`, then
`npx @shortwind/cli@beta init --preset all`. The CLI was smooth: it detected the
bundler, installed `@shortwind/tailwind` + `@shortwind/vite`, copied an editable
`recipes/` folder (19 families), scaffolded a shadcn-style theme into
`src/index.css`, and wrote a `SKILL.md` palette. One manual step (documented
clearly): add `shortwind()` *before* `tailwindcss()` in the Vite plugins array.
`npm run build` succeeds, and `grep` confirms the dist JS/CSS contain **zero**
`@recipe` directives and zero `@<family>` shorthands — they all expanded to plain
Tailwind. The "identical output" claim holds.

## Where it genuinely saved effort

For static, design-system furniture it's a real win. `@card-elevated`,
`@badge-success`, `@btn-primary`, `@input`, `@tab`/`@tab-active`, `@empty-*`,
`@code-inline` each collapse a long, easy-to-typo utility string into one token,
and — the part I'd actually pay for — they ship pre-baked with sensible
`focus-visible` and `dark:` variants I didn't have to remember. The badge tones
already carried their dark pairs; buttons already had focus rings. Combining
worked as advertised: `@input w-64 pl-9` (recipe + two raw overrides in one
literal) did exactly what I wanted, last-wins. And because the theme scaffold
ships oklch tokens plus a `.dark` variant, dark mode was genuinely *free* — I
toggled one class on `<html>` and the whole UI flipped correctly.

## Where I got stuck — the central tension

A deployments dashboard is inherently stateful, and Shortwind only expands
recipes inside **literal** `class`/`className` attributes. The instant a class
depends on state, the natural React idioms break: `className={active ?
"@tab-active" : "@tab"}` and a `{ success: "@badge-success" }` lookup map both
silently ship dead `@recipe` tokens and render unstyled. SKILL.md *does* warn
about this (credit there), but it's a sharp edge precisely because the most
ergonomic React patterns are the ones that fail. I restructured every dynamic
spot into either per-branch literal attributes — rendering the element twice
across a ternary, each branch with its own static `className="@tab-active"` /
`"@tab"` — or kept recipes out of expressions entirely. The deployment row's
density padding and failed-row red edge I wrote in **raw Tailwind**, because
expressing a runtime-variable element through static literal recipes would mean
duplicating the entire row markup per state. So I leaned on recipes for the
static scaffolding and hand-wrote the parts that actually vary — which is the
inverse of where I'd most want the help.

## The documented escape hatch was a dead end as shipped

The docs' "dynamic classes" page recommends an `rc()` helper built on
`expandClassList` / `buildRegistry` / `parseRecipeFile` from `@shortwind/core`,
fed by `import.meta.glob("recipes/*.css", { query: "?raw" })`. Two problems, both
verified:

1. **`@shortwind/core` isn't installed.** `init` only declares
   `@shortwind/tailwind` and `@shortwind/vite`. `@shortwind/core` exists only as a
   transitive package in the pnpm store, not a declared dependency — so
   `import { expandClassList } from "@shortwind/core"` doesn't resolve until you
   manually `npm install` it, and nothing in the docs tells you to.
2. **It would defeat the build gate.** That helper inlines the raw recipe CSS
   into the client bundle via `?raw`, and those files literally contain `@recipe`
   definition tokens (7 in `badge.css` alone) plus `@card`-style cross-references.
   The officially recommended way to handle dynamic classes would have planted
   exactly the `@recipe` tokens the build is supposed to eliminate — directly
   failing the "no leftover tokens in dist" requirement.

So I didn't use it. Literal per-branch classNames kept the bundle clean (grep
confirms), but it's notable that the tool's own answer to the problem I actually
hit was both uninstalled and self-defeating against its own correctness story.

## Smaller surprises

- The shortwind.dev homepage hero demo uses `@eyebrow`, which **isn't in the
  installed catalog** (the text family ships `@caption`/`@label`/`@muted`, no
  `@eyebrow`). The first thing you'd copy off the landing page doesn't exist in
  your project.
- Unrelated to Shortwind: `npm create vite@latest . -- --template react-ts
  --yes` silently scaffolded the *vanilla* TS template; I had to add React,
  `@vitejs/plugin-react`, and JSX config by hand.

## Net

For static, design-system-shaped markup, Shortwind is a real token-and-effort
saver and the dark-mode-for-free is not a gimmick. For the interactive core of a
dashboard it fights the React grain — every stateful class is a place you can
silently ship a dead token — and the documented workaround neither installed nor
survived the build gate. I'd reach for it again for landing pages, marketing
blocks, and mostly-static internal screens; for a heavily stateful app I'd want a
first-class build-time expansion for *expressions*, not just literals.
