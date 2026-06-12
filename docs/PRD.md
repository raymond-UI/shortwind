# Shortwind — Product Requirements Document

## Problem Statement

When an LLM generates HTML for an artifact, mockup, dashboard, or PR write-up, 35–50% of its output tokens go to Tailwind class strings. Strings like `rounded-lg border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow` are repeated across every card, button, and section. The model burns tokens (and the user burns budget) re-emitting the same canonical class clusters thousands of times per session.

Existing approaches don't fix this:

- **Raw Tailwind** is the status quo — clean for humans, expensive for LLMs.
- **`@apply` / component CSS** moves the cost into a stylesheet the LLM doesn't see and can't author per-document.
- **Component libraries (MUI and friends)** require runtime + JSX — they don't help when the LLM emits standalone HTML for a one-off artifact.
- **Emmet / Pug / MJML** are real DSLs with grammar — the LLM has to *learn parsing*, then frequently gets it wrong.

The user wants:

- A way for any LLM to emit visually rich HTML at much lower token cost.
- The result to render correctly in a browser today — no special runtime in production, no exotic build step.
- The teaching surface to be auto-discovered by every major agent harness (Claude Code, Cursor, Copilot, Aider, Continue), with zero per-harness fan-out.
- Customization without a new grammar — preferably "edit the file."
- A distribution model where the recipes live in *your* repo (copy-in ownership), but updates don't go stale forever.

## Solution

Shortwind is a token-efficient class layer for LLM-generated HTML. The LLM writes `class="@card-elevated @stack-md"` instead of a long Tailwind string; a tiny expander rewrites each `@recipe` to its canonical Tailwind cluster *before* the browser (or build step) sees it. Same rendered output. ~50% fewer tokens for the LLM to produce.

Two expansion paths share a single source of truth (`@shortwind/core`):

- **Build-time** — a bundler plugin (Vite/Next/Astro) transforms source files before Tailwind's content scan. Production output ships zero `@` tokens.
- **Runtime CDN** — a ~6KB browser script (`shortwind.dev/expand.js`) walks the DOM before first paint. For LLM artifacts emitted straight into a `.html` file with no build step.

Recipes live as `.css` files in `./recipes/<family>.css` in the user's repo (copy-in ownership). The CLI auto-generates a [skills.sh](https://skills.sh)-conformant `skills/shortwind/SKILL.md` whenever the recipes change, giving every major agent harness native discovery without per-tool symlinks.

The teaching surface is **vocabulary, not grammar**: ~100 flat recipe names following the rigid pattern `@<family>[-<intent>][-<size>]`. No parameters. No new syntax. The LLM memorizes a small table on turn one.

## User Stories

### Authoring artifacts

1. As an LLM emitting an HTML artifact, I want short `@`-prefixed names instead of long Tailwind strings, so that I spend fewer output tokens per visual.
2. As a Claude Code user, I want my agent to discover Shortwind's vocabulary automatically when I run it in a Shortwind project, so that I don't have to paste a prompt every session.
3. As a developer reviewing LLM-generated HTML, I want recipe names to read like human concepts (`@card-elevated`, `@btn-primary`), so that view-source remains intelligible.
4. As an LLM, I want recipes to bake in their canonical hover/focus/dark states, so that I never have to remember accessibility classes for common patterns.
5. As an LLM, I want a fallback to raw Tailwind for shapes the recipes don't cover, so that I'm never blocked.
6. As an LLM, I want predictable suffix order (`@btn-primary-lg`, never `@btn-lg-primary`), so that I generalize correctly from a small number of examples.

### Using Shortwind in a project

7. As a React developer using Vite, I want `npx shortwind init` to wire everything in one command, so that my dev server, production build, and HMR all "just work" with recipes.
8. As a developer, I want to pick a preset (`starter` / `app` / `content` / `all`) during init, so that I start with a coherent recipe set without browsing the catalog.
9. As a developer, I want to add a family with `npx shortwind add table`, so that I extend my vocabulary on demand.
10. As a developer, I want recipes to live in my repo (not in `node_modules`), so that I can read, grep, edit, and version-control them.
11. As a developer, I want raw Tailwind utilities to compose freely with recipes (`@card p-8 bg-amber-50`), so that overrides don't require a new mechanism.
12. As a developer, I want conflicts resolved last-position-wins (via `tailwind-merge`), so that the mental model matches what the `cn()` helper already taught me.

### Customization

13. As a designer adjusting visual style, I want to edit `recipes/card.css` directly, so that the whole project picks up the change.
14. As a developer who wants a tighter card variant, I want to add a sibling recipe `@card-tight` next to `@card`, so that the LLM can pick the right one from context.
15. As a developer integrating with another team's Shortwind project, I want to rename a colliding family on install (`shortwind add card --as marketing-card`), so that names don't conflict.

### Updates and freshness

16. As a developer who installed Shortwind months ago, I want `shortwind upgrade` to show me what's changed upstream, so that my recipes don't go stale forever.
17. As a developer who edited `recipes/button.css`, I want the upgrade flow to detect my edits and prompt for confirmation, so that my changes don't get clobbered.
18. As a CI maintainer, I want `shortwind upgrade --check` to exit non-zero if my project has drifted from the registry, so that I can gate on freshness.
19. As a developer, I want a lockfile (`recipes/.shortwind-lock.json`) committed alongside the recipe files, so that every dev on the team installs the same versions.

### Editor experience

20. As a developer editing `recipes/card.css`, I want hover-to-see-expansion on `@card` references inside the file, so that I can navigate without leaving the editor.
21. As a developer, I want hover on `rounded-xl` inside an expansion to show the underlying CSS, so that I can debug at any layer.
22. As a developer, I do not want to install a custom VS Code extension — Tailwind IntelliSense's `experimental.classRegex` should handle hover via a single setting `shortwind init` writes.

### Agent harness integration

23. As a Claude Code / Cursor / Copilot / Aider / Continue user, I want my agent to auto-discover `skills/shortwind/SKILL.md` without me configuring anything, so that the teaching surface is universal.
24. As a project owner, I want the `SKILL.md` to regenerate automatically whenever I edit `recipes/`, so that the teaching surface never drifts from the source of truth.

### Standalone artifacts

25. As a developer pasting an LLM-emitted HTML artifact into `index.html` and opening it locally, I want a one-line `<script src="https://shortwind.dev/expand.js">` to make it render correctly, so that the artifact "just works" with no build step.
26. As a recipient of a shared artifact, I want view-source to reveal the `@recipes` used, so that I can `npx shortwind add` the same families into my own project.

### Security and trust

27. As a developer adopting Shortwind in 2026, I want sensible dependency pins and a documented security posture, so that I'm not exposed to the next npm supply chain worm.
28. As a CI maintainer, I want `pnpm.minimumReleaseAge` to keep brand-new (potentially-malicious) package versions out of my install graph, so that fresh attacks have time to be caught before they propagate.

### Catalog discovery

29. As a developer exploring Shortwind, I want `shortwind.dev/catalog` to show every family visually with expansions and rendered previews, so that I can pick the right families before installing.
30. As a developer who wants to try shorthand without a project, I want `shortwind.dev/playground` to render my pasted HTML live, so that I can experiment with zero install.

## Implementation Decisions

### Expansion model

- Recipes are stored in `.css` files with a custom `@recipe <name> { <class-list> }` at-rule. The body is a **class list, not CSS declarations** — no semicolons, no `@apply`.
- A recipe may reference other recipes (`@recipe card-elevated { @card shadow-md ... }`). Resolution is topological; arbitrary depth is allowed; cycles are a hard lint error.
- The expander walks `class="..."` attributes (or `className=` literals in JS frameworks). Each `@name` is substituted; references inside are resolved in turn; the resulting class list is run through `tailwind-merge` for last-position-wins conflict resolution.
- `hover:@recipe` is **not legal**. States bake into recipe definitions; raw Tailwind utilities are appended for one-off state.

### Naming and catalog

- Shape: `@<family>[-<intent>][-<size>]`.
- Allowed sizes: `xs`, `sm`, `md`, `lg`, `xl`.
- Allowed intents: `primary`, `secondary`, `ghost`, `danger`, `warning`, `success`, `info`.
- Default catalog: 19 families, ~100 recipes total.
- Presets at init time: `starter` (5 families), `app` (12 — default), `content` (9), `all` (19).
- Preset definitions live in `shortwind.dev/registry/presets.json` (registry-driven, not CLI-hardcoded).

### Distribution

- Recipes are copied source code in the user's `./recipes/` directory (copy-in ownership). Not a runtime dependency.
- Each recipe file carries a fingerprint header: `/* shortwind: <family>@<version> sha:<6-char> — DO NOT EDIT THIS LINE */`.
- Lockfile at `recipes/.shortwind-lock.json`.
- `shortwind upgrade` diffs file sha against the lockfile, applies clean updates non-interactively, prompts on touched files with a 3-way diff.
- Per-family changelogs at `shortwind.dev/registry/<family>/CHANGELOG.md`.
- Registry URLs are immutable per version (`card@0.4.2.css`); unversioned URL (`card.css`) tracks latest. Same model as npm and esm.sh.
- `shortwind.config.json` accepts an optional `registry: <url>` override for enterprise mirrors.

### Package layout

- `@shortwind/core` — parser, resolver, `expand()`. Pure, no Tailwind dep. Used by every other package and the CDN runtime.
- `@shortwind/tailwind` — single integration package. Detects Tailwind v3 vs v4 from the consuming project's `package.json` and registers via the correct plugin API.
- `@shortwind/vite`, `@shortwind/next`, `@shortwind/astro` — bundler shells. Each ~30 LOC over the Tailwind package.
- `@shortwind/registry` — workspace-private. Source-of-truth recipes + a build script that emits `apps/web/public/registry/**` for the site to serve.
- `shortwind` (CLI) — composes the above; thin command facade.
- `apps/web` — TanStack Start on Cloudflare Workers, hosting `shortwind.dev`. Serves the marketing site, docs, catalog, playground, registry endpoints, and the CDN expander as static assets via the `ASSETS` binding.

### Hosting and CDN

- Single Cloudflare Worker deploy hosts everything. No R2 split for v1.
- Static asset paths (cached at the edge):
  - `/expand.js` — current runtime expander
  - `/expand@<version>.js` — immutable version-pinned (`Cache-Control: public, max-age=31536000, immutable`)
  - `/registry/<family>.css` — current
  - `/registry/<family>@<version>.css` — pinned
  - `/registry/presets.json`, `/registry/manifest.json`
  - `/registry/<family>/CHANGELOG.md`
- Build pipeline: `packages/registry/build.ts` runs before `vite build`, populates `apps/web/public/registry/**` and `apps/web/public/expand*.js`. `wrangler deploy` ships site + registry + CDN atomically.

### CLI dependency stack (fast modern)

- Arg parsing: `cac` (matches Vite ecosystem)
- Interactive prompts: `@clack/prompts` (matches Astro and other modern CLIs)
- Colors: `picocolors`
- Globbing: `tinyglobby`
- File watching: `chokidar`
- Diffing: `diff`
- Semver: `semver`
- JSONC editing (for `wrangler.jsonc`, `tsconfig.json`): `jsonc-parser`
- Package manager detection: `detect-package-manager`
- HTTP: native `fetch`
- Bundling the CLI: `tsdown` (Rolldown-based, ~10ms cold start)

### Teaching surface — skills.sh standard

- Generated `SKILL.md` at `skills/shortwind/SKILL.md`, conforming to skills.sh frontmatter (`name`, `description`) and section conventions (`## When to use`, `## How to use`, `## Available recipes` grouped by family).
- Regenerated automatically on any change in `./recipes/`. Three layered surfaces ensure freshness:
  1. `shortwind dev` (chokidar watcher) for solo dev.
  2. Bundler plugins hook the dev-server file watcher.
  3. Pre-commit hook installed by `init` guarantees committed `SKILL.md` is fresh.
- No per-harness fan-out (no `CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.windsurfrules` symlinks). Skills.sh subsumes all of them.

### Security posture

- Exact pins (no caret) on actively-targeted packages — currently `@tanstack/react-router@1.169.2`, `@tanstack/react-start@1.167.65` (the Mini Shai-Hulud attack of 2026-05-11 confirmed both lines need exact pinning).
- `pnpm.minimumReleaseAge: 4320` (72h) in the root `package.json`. Workspace packages exempted.
- `pnpm-lock.yaml` is the source of truth; CI fails on drift.
- README documents the policy so loosening a pin requires PR justification.

### Linting

- `recipe/no-sibling-overlap` (warn) — two recipes from the same family on one element.
- `recipe/conflicting-intent` (warn) — `@btn-primary @btn-danger`.
- `recipe/no-redundant-utility` (info) — appending a utility that's already in the recipe.
- `recipe/unknown` (error) — `@name` with no matching recipe.
- `recipe/cycle` (error) — transitive self-reference.
- `recipe/bad-suffix-order` (warn, auto-fixable) — `@btn-lg-primary`.
- `recipe/dynamic-class` (warn) — likely-computed recipe name (`@${variant}`).

## Testing Decisions

A good test for this codebase verifies **external behavior of a deep module** — given inputs, the output matches. It does not assert on the names of internal functions, internal helper invocations, or file-system paths used for caching. Tests should survive a full refactor of internals as long as the public interface contract holds.

### Heavy test coverage

- **`@shortwind/core` — parser.** Given a recipe `.css` string, the parser returns the expected `Recipe[]` (name, description from leading comment, class-list tokens, references to other recipes). Edge cases: multiline bodies, comments inside the body, missing braces, weird whitespace, Unicode in names.
- **`@shortwind/core` — resolver.** Given a `Recipe[]`, the resolver produces a flat lookup table mapping each recipe name to its fully-expanded class list. Tests cover: deep reference chains, cycles (must throw), self-reference, references to unknown recipes (must throw with a useful error).
- **`@shortwind/core` — expander.** Given an HTML or JSX string + registry, the expander returns the expected output with `@recipes` substituted and `tailwind-merge` applied. Tests cover: multiple recipes on one element, mixed recipes and raw utilities, recipes inside JSX template literals (literal portions only), `class=""` and `className=""` variants, leaving unknown `@names` untouched, dynamic class expressions left untouched.
- **CLI `upgrade` flow.** Given a `recipes/` directory + lockfile + a mocked registry, the upgrade produces the expected file changes and prompts. Tests cover: pristine file (clean apply, no prompt), touched file (3-way diff produced, user accept/reject), multiple families at different versions, lockfile updates atomic with file writes, `--check` exits non-zero on drift, `--force` skips touched detection.

### Medium test coverage

- **CLI `init`.** Against a tmp dir: each preset produces the expected file tree, `package.json` edits, `wrangler.jsonc` is parsed and re-written without breaking comments, `.vscode/settings.json` gets the `classRegex` entry, pre-commit hook is installed. Tests cover idempotency (re-running `init` doesn't clobber edits).
- **CLI `add`.** A family is fetched from a mocked registry, written to `recipes/`, lockfile updated, `SKILL.md` regenerated. `--as <name>` correctly rewrites the file's recipes.
- **`@shortwind/tailwind`** — smoke tests against pinned Tailwind v3 and v4. A minimal project + recipe + page is built; the output CSS contains the expected utility classes.

### Light test coverage

- **Bundler plugins.** One smoke test per (Vite, Next, Astro): given a source file referencing `@card`, the post-transform source contains the expanded class list and the produced CSS contains the underlying Tailwind rules.

### Out-of-scope for v1

- `apps/web` UI tests (visual catalog, playground). E2E later when the site stabilizes.
- Cross-bundler integration matrix beyond smoke tests.
- Performance benchmarks (will add when we have real-world projects to measure).

### Prior art / patterns

- Resolver + cycle detection: standard topological sort with visited/visiting sets. Reference patterns from `postcss` and `lightningcss` codebases.
- Snapshot tests for the parser/expander: use Vitest's inline snapshots; same pattern Vite and Tailwind use for their own internals.
- 3-way diff display: borrow from `diff` library's structured output; format like `git diff --merge`.
- Mocked registry for `add`/`upgrade` tests: spin up a static-file server on localhost in `beforeAll`. The standard pattern for registry-backed CLI tests.

## Out of Scope

- **Community-contributed recipes / third-party namespaces.** Deferred until after v1 stabilizes; the registry is single-source for now.
- **Recipe parameters / argument syntax.** `@btn(primary, lg)` was rejected by design — flat names with predictable suffixes give the same expressive power without grammar.
- **Custom hover behavior beyond what Tailwind IntelliSense's `experimental.classRegex` provides.** No bespoke VS Code extension.
- **A new build system or alternative to Tailwind.** Shortwind is a layer *over* Tailwind, not a replacement.
- **Compatibility with non-Tailwind utility frameworks** (UnoCSS, Master CSS, etc.) for v1. Possible later if there's demand.
- **Server-side rendering hooks beyond the existing bundler integrations.** SSR works because the bundler plugin runs at build/dev time; no extra runtime needed.
- **Telemetry, analytics, or account systems** on `shortwind.dev`. Pure static site for v1.
- **Renaming of `shortwind` to anything else.** The name is set.

## Further Notes

- The product's defensibility is the **teaching surface**, not the expander. The expander is ~200 LOC. The defensibility is in:
  1. The curated 19-family / ~100-recipe default catalog.
  2. The skills.sh-conformant `SKILL.md` template that's tuned for LLM recall.
  3. The auto-sync machinery that keeps that teaching surface fresh.
- The **runtime CDN expander** is strategically critical even though most production usage is build-time. It's what makes "Claude artifact pasted into a .html file" work, which is the most viral demo path.
- The npm supply chain landscape in 2025-2026 has forced an unusually defensive security posture into v1. Don't relax it without a clear reason.
- The decision to use TanStack Start + Cloudflare Workers (over Astro on Pages or Next on Vercel) is grounded in: (a) existing internal templates in the user's codebase using this stack, (b) the single-Worker-serves-everything property fitting Shortwind's "static + tiny dynamic" shape exactly, (c) Cloudflare's free static-asset tier covering us indefinitely.
