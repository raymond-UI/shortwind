# Shortwind

`shortwind.dev` — a token-efficient class layer for LLM-generated HTML. Flat vocabulary, no new grammar, distributed shadcn-style.

LLMs spend 35–50% of HTML output tokens on Tailwind class strings. Shortwind collapses common class clusters into 1–3-token recipes the model can memorise on turn one.

---

## At a glance

```html
<!-- The LLM emits -->
<article class="@card-elevated @stack-md">
  <header class="@row-between">
    <h3 class="@heading-md">Quarterly review</h3>
    <span class="@badge-success">On track</span>
  </header>
  <p class="@muted">3 of 5 milestones complete.</p>
  <div class="@row">
    <button class="@btn-primary">Open</button>
    <button class="@btn-ghost">Skip</button>
  </div>
</article>
```

A 10-line expander rewrites `@card-elevated` to its canonical Tailwind class cluster before the browser (or build step) ever sees it. Same rendered output. ~50% fewer tokens for the LLM to produce.

### Measured savings

Run on the bundled corpus (`shortwind bench --corpus`) — five representative component files, counted with the cl100k_base BPE tokenizer:

| Metric | Shortwind | Expanded | Saved |
| --- | --: | --: | --: |
| Class-string tokens | 125 | 658 | **81.0%** |
| Whole-file LLM tokens | 1,255 | 3,001 | **58.2%** |

Per-file whole-file savings range from 46.6% (layout files that mix recipes with raw utilities) to 77.9% (recipe-dense component files). The benchmark runs in CI, so these numbers stay honest as the catalog changes. Reproduce locally with `shortwind bench --corpus`, or measure your own project with `shortwind bench`.

---

## Install

One command sets everything up:

```bash
npx @shortwind/cli@beta init      # beta: published on the `beta` tag
```

`init` detects your bundler and does the whole wiring:

- Adds **exactly one** adapter — `@shortwind/vite`, `@shortwind/next`, or `@shortwind/astro` — plus the Tailwind integration, as devDependencies. (`@shortwind/core` comes in transitively; **you never install it directly**.)
- Copies the recipe catalog into `./recipes/` — yours to edit and own.
- Writes `skills/shortwind/SKILL.md`, wires the plugin into your config, and installs a pre-commit hook.

**You do not install all the `@shortwind/*` packages** — a project needs one adapter, and `init` picks it. The standalone CDN path (`shortwind.dev/expand.js`) needs no install and no `init` at all — just a `<script>` tag.

---

## How it works

1. **LLM writes shorthand.** Recipes prefixed with `@` inside `class="..."`.
2. **Expander resolves recipes.** Each `@name` is replaced with its definition, then recipe references inside the result are resolved in turn. Arbitrary depth is fine; `shortwind lint` rejects cycles. Conflicts resolved by `tailwind-merge` (last position wins).
3. **Tailwind sees only utility classes.** No runtime cost in production, no semantic change. Purge, JIT, dev server all work normally.

Shortwind is a **macro layer at the HTML class-attribute level**. It is not `@apply`. Tailwind never sees the `@recipe` directive — the expander runs before Tailwind compiles.

### Two expansion paths, one source of truth

The same recipe `.css` files feed both:

- **Build-time (bundler plugin).** Standard path for app projects. Vite/Next/Astro plugin transforms source files (`.tsx`, `.vue`, `.svelte`, `.astro`, `.html`) before Tailwind's content scan. JIT sees expanded classes. Production output ships zero `@` tokens and no runtime expander — just plain Tailwind.
- **Runtime (CDN expander).** For standalone HTML artifacts an LLM emits straight to a `.html` file. A ~6KB `shortwind.dev/expand.js` walks the DOM before first paint, substitutes recipes, and lets Tailwind Play CDN handle the rest. No build step, no install — the "Claude artifact just works" path.

Both paths share `@shortwind/core` — same parser, same resolver, same `tailwind-merge` semantics. A page rendered through the bundler and a page rendered through the CDN expander produce byte-identical class output.

**Dynamic classes caveat:** `className={isActive ? '@btn-primary' : '@btn-ghost'}` works (literals in source). `className={\`@${variant}\`}` does not — same JIT limitation Tailwind itself has. Convention: keep recipe names literal, use `cn()` helpers for composition.

---

## Recipe format — `.css` files with `@recipe`

Recipes live in `.css` files. That single choice unlocks comments, multi-line definitions, universal syntax highlighting, and — via Tailwind IntelliSense's `experimental.classRegex` setting — free hover, autocomplete, and color swatches inside recipe definitions. No editor extension to build.

### Syntax

The body of `@recipe <name> { ... }` is a **class list, not CSS declarations.** No semicolons, no `@apply`. Multiline OK. The comment immediately above a recipe becomes its description in the generated `SKILL.md`.

```css
/* recipes/card.css */
/* shortwind: card@0.4.2 sha:b0a1c3 — DO NOT EDIT THIS LINE */

/* Default content card. */
@recipe card {
  rounded-lg border border-zinc-200 bg-white p-4 shadow-sm
}

/* Raised card for primary content. Built on @card. */
@recipe card-elevated {
  @card rounded-xl p-6 hover:shadow-md transition-shadow
}

/* Interactive card with full hover + focus states baked in. */
@recipe card-interactive {
  @card hover:shadow-md hover:border-zinc-300
  focus-visible:ring-2 focus-visible:ring-zinc-900
  cursor-pointer transition-all
}

@recipe card-flat   { rounded-lg bg-zinc-50 p-4 }
@recipe card-header { flex items-center justify-between pb-3 border-b border-zinc-100 }
```

Why not `@apply`? `@apply` compiles utilities into a CSS rule's declarations. Shortwind does the opposite — it rewrites `class=""` and leaves CSS untouched. Reusing `@apply` would invite confusion (and bug reports like "why doesn't `@apply @card` work inside `.btn`?"). Cleaner to have our own at-rule whose body is literally a class list.

### Composition

A recipe may reference other recipes (`@card-elevated` extends `@card` above). The expander resolves references topologically; arbitrary depth is fine. `shortwind lint` rejects cycles as a hard error.

The generated `SKILL.md` always shows the **fully flattened** class list to the LLM, so the agent sees the real cost of each recipe and never has to follow references at inference time.

### States and variants

Recipes bake in their canonical hover/focus/active/dark states. The LLM picks `@card` or `@card-interactive`; it never writes `hover:@card`.

- `hover:@recipe` is **not legal syntax.** Variants don't distribute over recipe bodies. (`hover:rounded-lg` is meaningless and the explosion is a footgun.)
- Want one-off state? Append raw Tailwind: `class="@card hover:scale-[1.02]"`. Recipes and utilities compose freely; `tailwind-merge` resolves conflicts.
- The default catalog ships **paired recipes** where state matters: `@card` / `@card-interactive`, `@btn-primary` / `@btn-primary-loading`, `@input` / `@input-error`. They group together in `SKILL.md` so the agent sees the choices together.

---

## Grouping — one file per family

**File = family. File name = family root.** A family is a set of related recipes added or removed together. This mirrors shadcn's pattern where `card.tsx` ships all card primitives in one file.

```
recipes/
  card.css        button.css     badge.css      layout.css
  text.css        form.css       surface.css    feedback.css
  navigation.css  list.css       table.css      media.css
  code.css        dialog.css     empty.css      progress.css
  tooltip.css     skeleton.css   icon.css
                  (SKILL.md is written to skills/shortwind/ — see below)
```

The family is the unit of installation, removal, distribution, and prompt section.

Recipes can compose across families (see "Composition" above for the resolution rule). `shortwind add card` reads cross-family references like `@stack-md` and warns if `layout` isn't installed.

---

## Naming convention — predictable suffixes, no grammar

Names are flat, but they follow a rigid pattern so the LLM generalises instead of memorising every combination.

**Shape:** `@<family>[-<intent>][-<size>]`

| Token kind | Allowed values |
|---|---|
| **Size suffix** | `xs`, `sm`, `md`, `lg`, `xl` |
| **Intent suffix** | `primary`, `secondary`, `ghost`, `danger`, `warning`, `success`, `info` |
| **Order** | intent first, size last — `@btn-primary-lg`, never `@btn-lg-primary` |

Not every family uses both axes. `@stack-md` (size only). `@badge-success` (intent only). `@btn-primary-lg` (both). The catalog generator omits combinations that don't make sense (`@stack-primary` is not produced).

`shortwind lint` enforces the ordering rule. Anything outside the fixed token set is just a normal flat name (`@nav-active`, `@card-header`) — the convention is a strong default, not a straightjacket.

Why no `@btn(primary, lg)` parameter syntax? Parameters are grammar. Grammar is a new way for the LLM to be wrong (`@btn(lg, primary)` vs `@btn(primary, lg)` vs `@btn-primary-lg`). Flat names with predictable suffixes give the regularity at zero parsing cost.

---

## Default catalog

The starter set, shipped as `@shortwind/default`. ~19 families, ~150–200 recipes total. Files are tiny so we ship broad on purpose — the LLM should almost never need to fall back to raw Tailwind for common shapes.

| Family | Examples |
|---|---|
| `card` | `card`, `card-elevated`, `card-flat`, `card-interactive`, `card-header`, `card-body`, `card-footer` |
| `button` | `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-destructive`, `btn-outline`, `btn-icon`, `btn-sm`, `btn-lg` |
| `badge` | `badge`, `badge-success`, `badge-warning`, `badge-danger`, `badge-info`, `badge-outline` |
| `layout` | `stack-xs`, `stack-sm`, `stack-md`, `stack-lg`, `row`, `row-between`, `row-end`, `grid-2`, `grid-3`, `grid-4`, `center`, `full` |
| `text` | `heading-xl`, `heading-lg`, `heading-md`, `heading-sm`, `body`, `muted`, `label`, `caption`, `link` |
| `form` | `input`, `textarea`, `select`, `checkbox`, `radio`, `field`, `field-error`, `fieldset` |
| `surface` | `surface`, `surface-muted`, `surface-accent`, `container`, `container-tight`, `divider-h`, `divider-v` |
| `feedback` | `alert`, `alert-success`, `alert-warning`, `alert-danger`, `callout`, `toast`, `banner` |
| `navigation` | `nav`, `nav-link`, `nav-link-active`, `breadcrumb`, `tab`, `tab-active` |
| `list` | `list`, `list-item`, `list-bordered`, `dl`, `dt`, `dd` |
| `table` | `table`, `th`, `td`, `tr-hover`, `table-zebra` |
| `media` | `avatar`, `avatar-sm`, `avatar-lg`, `thumb`, `aspect-square`, `aspect-video` |
| `code` | `code-inline`, `code-block`, `kbd` |
| `dialog` | `dialog`, `dialog-overlay`, `dialog-content`, `dialog-header`, `dialog-footer` |
| `empty` | `empty`, `empty-icon`, `empty-title`, `empty-description` |
| `progress` | `progress-track`, `progress-bar`, `spinner` |
| `tooltip` | `tooltip` |
| `skeleton` | `skeleton`, `skeleton-text`, `skeleton-circle` |
| `icon` | `icon-sm`, `icon-md`, `icon-lg`, `icon-muted` |

---

## CLI

The CLI ships as **`@shortwind/cli`** and provides the `shortwind` command. While in beta it's published on the `beta` tag, so install with `@beta`:

```bash
# one-off, no install:
npx @shortwind/cli@beta init

# or install it (the `shortwind` command becomes available):
npm i -D @shortwind/cli@beta      # pnpm add -D / yarn add -D
```

Once installed, run the `shortwind` command directly (or prefix any example below with `npx @shortwind/cli@beta` to run without installing):

```bash
shortwind init                                    # interactive: pick a preset, wire plugin, write SKILL.md
shortwind init --preset=app                       # non-interactive (starter | app | content | all | none)
shortwind add card button badge layout
shortwind add card --as marketing-card            # rename on install to avoid collision
shortwind new marketing                           # scaffold your own custom recipe family
shortwind remove table                            # delete a family + its skills section
shortwind preset app                              # switch presets (additive — never auto-removes)
shortwind upgrade                                 # interactive: walk families, show changelogs, prompt on touched files
shortwind upgrade --check                         # CI-friendly: exits non-zero if drift exists
shortwind dev                                     # watch ./recipes/, regenerate SKILL.md on save
shortwind build                                   # one-shot regenerate SKILL.md
shortwind ls                                      # list installed families + recipes
shortwind lint                                    # validate recipe usage, naming, cycles, conflicts
```

### Init presets

`shortwind init` prompts for one of four presets. Recipes are copied into `./recipes/`; you own them from that moment.

| Preset | Families | Use case | Catalog size |
|---|---|---|---|
| **starter** | card, button, layout, text, form | Grow the catalog as you go | ~25 recipes |
| **app** ← default | starter + badge, table, dialog, list, navigation, feedback, tooltip | Typical web app UI | ~65 recipes |
| **content** | starter + badge, code, list, media, empty | Docs, blog, marketing-leaning sites | ~50 recipes |
| **all** | every family | Power users who want everything | ~100 recipes |

Presets are registry-driven (`shortwind.dev/registry/presets.json`) so they can be revised without a CLI release.

### Namespacing rule

Family names are the only namespace. If a family name would collide with one already installed, `add` refuses unless `--as <new-name>` is passed; the rename rewrites the file *and* every `@root-*` recipe inside it to `@new-name-*`. One rename at install, zero tokens of namespace overhead per use, no two-file conflict possible.

---

## Generated teaching — a [skills.sh](https://www.skills.sh)-conformant SKILL.md, auto-synced

Shortwind generates a standard [skills.sh](https://www.skills.sh) skill file at `skills/shortwind/SKILL.md`. Every major agent harness — Claude Code, Cursor, GitHub Copilot, Aider, Continue — already knows how to discover and load files at that path. No per-agent symlinks, no `CLAUDE.md` / `AGENTS.md` / `.cursorrules` fan-out. **One file, one standard, every harness.**

The file is **regenerated automatically** whenever any file in `./recipes/` changes. Manual regeneration is not part of the workflow.

### Skill file format

```md
---
name: shortwind
description: Use Shortwind recipes (@-prefixed shorthand) inside HTML class attributes to write Tailwind classes more efficiently. Apply when generating HTML for visual artifacts, mockups, dashboards, PR write-ups, or any UI output.
---

<!-- AUTO-GENERATED by shortwind. Edit recipes in ./recipes/*.css instead. -->

# Shortwind

Use Shortwind recipes for `class` attributes in HTML. Each recipe is a name
prefixed with `@` that expands to a canonical Tailwind class cluster.
Recipes and raw Tailwind compose freely.

## When to use

- Generating HTML artifacts, mockups, dashboards, or any visual output
- Producing markup that will be reviewed or shared as a rendered page
- Anywhere you would otherwise emit a long Tailwind class string

## How to use

1. Use `@recipe-name` inside `class="..."` for any recipe listed below.
2. Combine multiple recipes: `class="@card-elevated @stack-md"`.
3. Append raw Tailwind to override: `class="@card-elevated p-4 shadow-md"` —
   tailwind-merge resolves conflicts, last position wins.
4. If no recipe matches your intent, fall back to raw Tailwind.

## Available recipes

### Card recipes
  @card            rounded-lg border border-zinc-200 bg-white p-4 shadow-sm
  @card-elevated   rounded-xl border border-zinc-200 bg-white p-6 shadow-sm
                   hover:shadow-md transition-shadow
  @card-flat       rounded-lg bg-zinc-50 p-4
  @card-header     flex items-center justify-between pb-3 border-b border-zinc-100

### Button recipes
  @btn-primary     inline-flex items-center justify-center rounded-md
                   bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                   hover:bg-zinc-800
  @btn-ghost       inline-flex items-center justify-center rounded-md
                   px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100

### Layout recipes
  @stack-sm        flex flex-col gap-2
  @stack-md        flex flex-col gap-4
  @row             flex items-center gap-3
  @row-between     flex items-center justify-between
```

Frontmatter follows the skills.sh spec — `name` (lowercase, hyphens) and `description`. Section headers per family cost negligible tokens and meaningfully improve LLM recall versus a flat list.

### Generation rules

- **`description`** is the discovery hook. The default is engineered to fire on the actual phrases ("generate HTML," "mockup," "dashboard," "PR write-up") that agents use as triggers. Users can override the description in `shortwind.config.json` if their project needs different framing.
- **The recipe `description` field in each `.css` file feeds the prompt's inline comments.** Edit the comment in `recipes/card.css`, the explanation in `SKILL.md` updates on next sync.
- **Order of families in `SKILL.md`** mirrors `recipes/` directory order. Project owners can shuffle by renaming or by setting an explicit order in `shortwind.config.json`.

### Three layered surfaces ensure freshness

1. **`shortwind dev`** — chokidar watcher. Solo dev default. Same UX as `tailwindcss --watch`.
2. **Bundler plugins** — `shortwind/vite`, `shortwind/next`, `shortwind/astro`. Hooks the dev server's file watcher; no extra process.
3. **Pre-commit hook** — installed by `init`. Belt and suspenders, guarantees committed `SKILL.md` is fresh even if the other two are bypassed.

### Why skills.sh, not custom `prompt.md` + symlinks

Earlier drafts of this spec proposed a custom `prompt.md` with opt-in includes for `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`. Skills.sh subsumes all of that:

- **Already loaded by every target harness.** Claude Code discovers `skills/<name>/SKILL.md` natively. Same for Cursor and Copilot per the skills.sh compatibility list.
- **One file path to reason about.** No fan-out, no symlink hygiene.
- **Versionable and shareable.** The same `SKILL.md` works as a standalone artifact that any agent can ingest, even outside a Shortwind project.
- **Forward-compatible.** When new harnesses appear, they target the skills.sh standard rather than each agent inventing a file convention.

The earlier symlink design is dropped.

---

## Updating recipes

Recipes live in your repo (shadcn-style), but `shortwind upgrade` closes the staleness gap shadcn users have long complained about ([discussion #790](https://github.com/shadcn-ui/ui/discussions/790), [discussion #7170](https://github.com/shadcn-ui/ui/discussions/7170)).

Each recipe file carries a 1-line fingerprint header:

```css
/* shortwind: card@0.4.2 sha:b0a1c3 — DO NOT EDIT THIS LINE */
```

- **`shortwind upgrade`** compares the recorded sha to the current file content. **Pristine files** (sha matches) apply cleanly with no prompt. **Touched files** (sha mismatch — you've edited it) show a 3-way diff (your version, registry's old, registry's new) and require confirmation. Edits are never clobbered silently.
- **`recipes/.shortwind-lock.json`** records `{ family: version }` for the project. Lockfile commits with the code.
- **`shortwind upgrade --check`** is a read-only CI gate. Non-zero exit if the lockfile and registry have diverged.
- **`shortwind verify`** sanity-checks fingerprints — useful as a pre-commit step.
- **`shortwind upgrade --force`** skips touched-detection. Last resort.

Per-family changelogs live at `shortwind.dev/registry/<family>/CHANGELOG.md`. `upgrade` prints them inline before each prompt.

This is an incremental refinement of shadcn's existing `diff` flow, not a reinvention — fingerprints + lockfile + structured per-family changelog close the residual "applied manually, hope I got it right" gap.

---

## Customization

Three escalating answers, in order of preference.

### 1. Append-override (the 80% case)

```html
<article class="@card-elevated p-4 shadow-md">
```

`tailwind-merge` resolves conflicting utilities to last-position-wins. Same library shadcn's `cn()` uses internally. No new syntax, no config edit.

### 2. Edit the recipe file

Recipe files live in your repo. To change every `@card-elevated` project-wide, edit `recipes/card.css`. Commit. Done. No extends, no merge semantics.

### 3. Add a sibling variant

If a project needs both spacious and tight cards, add `@recipe card-elevated-tight` next to `@recipe card-elevated`. Names are memorable; the LLM picks the right one from context.

### What's not on the table

No parameter syntax. `@card-elevated(p=4)` would reintroduce grammar — parsing, validation, call-convention learning — and erase the whole vocabulary-over-grammar pitch.

> Recipes are nouns, not functions. Tweak by appending utilities. Add named variants when needed. Never parameterize.

---

## Composition with raw Tailwind

Recipes and raw utilities mix freely. `tailwind-merge` resolves conflicts predictably — same library shadcn's `cn()` uses internally; same last-position-wins semantics the Tailwind community already expects.

```html
<!-- All valid -->
<div class="@card">
<div class="@card @stack-md">
<div class="@card @stack-md p-8 bg-amber-50">
<div class="@card-elevated hover:scale-[1.01] transition-transform">
```

Unknown recipes (`@nope`) pass through to the output unchanged so the failure is visible at view-source.

### Conflict-resolution lint rules

`tailwind-merge` produces a defined result for any combination, but some combinations are almost always a mistake. `shortwind lint` surfaces them:

| Rule | Trigger | Severity |
|---|---|---|
| `recipe/no-sibling-overlap` | Two recipes from the same family on one element (`@card @card-elevated`, `@btn-primary @btn-ghost`) | Warning |
| `recipe/conflicting-intent` | Conflicting intent suffixes (`@btn-primary @btn-danger`) | Warning |
| `recipe/no-redundant-utility` | Raw utility already present in the recipe re-appended unchanged (`@card p-4` where `@card` already has `p-4`) | Info |
| `recipe/unknown` | `@name` with no matching recipe | Error |
| `recipe/cycle` | Recipe references itself transitively | Error |
| `recipe/bad-suffix-order` | `@btn-lg-primary` (size before intent) | Warning, auto-fixable |
| `recipe/dynamic-class` | Likely-computed recipe name (`@${variant}`) in source | Warning |

`shortwind lint --fix` repairs everything in the auto-fixable rows.

---

## Distribution & installation

Shadcn-style: **recipes are source code in your repo, not a dependency.** The CLI copies files into `./recipes/` and you own them from that moment.

### Package layout

`init` installs the right subset for you — this table is just what each package *is*. A typical project ends up with **one adapter + the Tailwind integration** (and `@shortwind/cli` for tooling); the rest are either transitive or for other entry points.

| Package | Role | You install it? |
|---|---|---|
| **`@shortwind/cli`** | `init`, `add`, `remove`, `upgrade`, `dev`, `build`, `lint`, `ls`, `preset`. Provides the `shortwind` command. | Tooling (or just `npx`) |
| **`@shortwind/vite`** / **`@shortwind/next`** / **`@shortwind/astro`** | Bundler plugin. Transforms source files before Tailwind's content scan. | **Pick one** (init adds it) |
| **`@shortwind/tailwind`** | Tailwind integration. Detects v3 vs v4 and registers via the correct plugin API. | init adds it |
| **`@shortwind/core`** | Parser, resolver, `expand()`. Zero Tailwind dependency. The shared engine. | No — transitive |
| **`@shortwind/runtime`** | Browser/CDN expander (~6KB, catalog inline). For the no-build path. | Only the CDN path |

Implementation details (PostCSS, Lightning CSS, etc.) are internal — never surfaced in package names, docs, or `init` output.

### Surfaces, by audience

| Surface | For | Install cost |
|---|---|---|
| **CDN script** (`shortwind.dev/expand.js`) | One-off HTML artifacts shared via S3/gist | Drop in `<script>` |
| **CLI + `recipes/` folder** | Any project with a repo | `shortwind init` |
| **Vite/Next/Astro plugin** | Production apps | Add to config |
| **Inline expander** | Fully self-contained HTML artifacts | LLM emits a 20-line `<script>` in the output |

### Tailwind v3 and v4

Both supported from day one. `shortwind init` reads `tailwindcss` from `package.json` and wires the correct plugin shell. The expander itself is Tailwind-version-agnostic — only the registration glue differs. v4's CSS-first config aligns naturally with our `.css` recipe files; on v4, recipes look like a native extension of `@theme` / `@source`.

### Catalog website

`shortwind.dev` — browse families visually, see expansions, see example rendering, click "add to project" for the `npx` command. Single official registry for v1.

Two-layer hover on the website:
- Hover `@card-elevated` → tooltip shows description + expansion (registry lookup).
- Hover `rounded-xl` inside the expansion → tooltip shows the underlying CSS (static class-to-CSS map, ~200KB JSON generated once at build time with `@tailwindcss/cli`).

View-source on shared shorthand HTML reveals the recipes used. Receivers `shortwind add` the missing families. View-source is the funnel.

### Hosting — TanStack Start on Cloudflare Workers

The marketing site, docs, catalog, playground, registry, and the runtime CDN expander all ship from a **single Cloudflare Worker** (TanStack Start + Vite + React 19 + Tailwind v4). Convention inherited from internal Cloudflare templates.

| Asset | Path | How it's served |
|---|---|---|
| Marketing pages, `/docs/*`, `/catalog`, `/playground` | TanStack Start routes | Worker SSR |
| `/expand.js` (runtime expander, latest) | Static asset | Worker `ASSETS` binding |
| `/expand@<version>.js` (immutable, version-pinned) | Static asset | `Cache-Control: public, max-age=31536000, immutable` |
| `/registry/<family>.css` (current) | Static asset | Edge-cached |
| `/registry/<family>@<version>.css` (pinned) | Static asset | Immutable cache |
| `/registry/presets.json`, `/registry/manifest.json` | Static asset | Edge-cached |
| `/registry/<family>/CHANGELOG.md` | Static asset | Edge-cached |

A pre-build step in `apps/web` reads `packages/registry/` and writes the registry + expander files into `public/` before `vite build`. `wrangler deploy` ships site + registry + CDN atomically.

**Why one Worker, not split to R2:** atomic deploys (no "site says v0.5 exists, registry 404s" window), zero ops, free edge cache, static-asset requests don't bill as Worker invocations. R2 is a graduation path if recipe-publish cadence ever decouples from site releases.

**Registry origin is overridable.** `shortwind.config.json` accepts `registry: "https://corp-internal.example.com"` — same shape as shadcn's. Enterprise mirrors and forks work without code changes.

### Monorepo layout

```
shortwind/
  apps/
    web/                 # TanStack Start on CF Workers — shortwind.dev
      src/routes/        # /, /docs/*, /catalog, /playground
      public/            # generated registry + expand.js dropped here pre-build
      wrangler.jsonc
      vite.config.ts
  packages/
    core/                # @shortwind/core — parser, resolver, expand()
    tailwind/            # @shortwind/tailwind — v3/v4 integration
    vite/                # @shortwind/vite
    next/                # @shortwind/next
    astro/               # @shortwind/astro
    registry/            # source-of-truth recipes (card.css, button.css, …)
    cli/                 # shortwind CLI
  pnpm-workspace.yaml
  turbo.json
```

---

## Why this is easy for LLMs

| Property | Consequence |
|---|---|
| Flat name → value table | Memorised on turn one (same shape as shadcn component names) |
| No grammar, no operators, no precedence | No parsing errors |
| Local error mode | Unknown `@name` stays in the attribute, rest of doc is unaffected |
| Trivial verification | A ~10-line linter validates every recipe usage |
| Composable with raw Tailwind | No either/or |
| Sectioned `SKILL.md` by family | Better recall than flat lists |
| Standard skill discovery | Every major harness auto-loads it without per-project wiring |

The full `SKILL.md` for the default catalog is ~150 lines. It fits in any system message and is loaded automatically by skills.sh-aware harnesses.

---

## Roadmap

| Phase | Scope |
|---|---|
| **1. `@shortwind/core` + CDN expander** | Parser, resolver, `expand()`. `shortwind.dev/expand.js` for standalone HTML. Zero-install proof. |
| **2. CLI + `.css` recipe format + auto-sync** | `init / add / remove / dev / build / lint / ls / preset`, presets, chokidar watcher, pre-commit hook, writes `.vscode/settings.json` classRegex |
| **3. Default catalog** | 19 families, ~100 recipes, published as `@shortwind/default` |
| **4. skills.sh-conformant `SKILL.md` generation** | `skills/shortwind/SKILL.md` written and watched by the CLI. Native discovery by every major harness, no per-agent file fan-out. |
| **5. `@shortwind/tailwind` — v3 + v4** | Single install, version-detects, registers via the correct plugin API. |
| **6. Bundler plugins** | `@shortwind/vite`, `@shortwind/next`, `@shortwind/astro` |
| **7. `shortwind upgrade`** | Fingerprint headers, lockfile, per-family changelogs, 3-way diff for touched files. |
| **8. Catalog website** | Browse, two-layer hover, copy command |

Community contributions and third-party namespaces are deferred until the core has shipped and there's clear pull. Registry is single-source for v1.

## Security posture

The npm ecosystem has had multiple high-impact supply chain attacks recently — the `Shai-Hulud` worm (Sept 2025, 500+ packages), the `qix` phishing attack (chalk/debug/ansi-styles, Sept 2025), and `Mini Shai-Hulud` (May 2026, 169 packages including 42 `@tanstack/*` releases). Shortwind's defensive posture:

- **Exact pins on actively-targeted packages.** `@tanstack/react-router` and `@tanstack/react-start` are pinned to exact versions (no caret), not ranges. Bumps require a deliberate PR with a security review.
- **`pnpm.minimumReleaseAge: 4320`** (72h) in the root `package.json`. pnpm refuses to install packages younger than 72 hours, giving the security community time to detect and pull malicious releases. Our own `@shortwind/*` workspace packages are exempted.
- **Lockfile committed.** `pnpm-lock.yaml` is the single source of truth for installed versions; CI fails on lockfile drift.
- **No build-time scripts from dependencies** beyond an explicit allowlist (`pnpm.onlyBuiltDependencies`, configured per environment).
- **Registry audits before each release.** `pnpm audit` + Socket.dev review of any new dep before merge.

Loosening a pin or shortening `minimumReleaseAge` requires a PR justification. Defaults err on the side of paranoia.

References: [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) · [Mini Shai-Hulud advisory](https://github.com/TanStack/router/security/advisories/GHSA-g7cv-rxg3-hmpx) · [CISA on Shai-Hulud](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem)

---

## License

MIT.

Editor hover/autocomplete is **not** a Shortwind deliverable. It falls out of choosing `.css` as the file format plus the `classRegex` setting written by `shortwind init`. Tailwind IntelliSense handles it for free.

---

## The one-line pitch

> Recipes are nouns. The model writes `@card-elevated`. A 10-line expander rewrites it to Tailwind. Your `./recipes/` folder *is* the LLM's vocabulary.
