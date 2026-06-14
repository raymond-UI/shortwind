# RFC: Editor tooling — recipe-token IntelliSense

Status: Phase 0 + Phase 1 + 1b + editor-load fix landed (branch `spike/ts-plugin`) · Date: 2026-06-14

## Status

- **Phase 0 — proven.** A TS language-service plugin returns completion + hover
  inside `className` strings, no extension. (Reference impl: Twind's plugin.)
- **Phase 1 — landed.** `@shortwind/ts-plugin` (private source) loads the
  project's real registry (`loadRegistryFromDir`, mtime-cached) and provides
  completion + hover-to-expand + go-to-definition. `init` wires the tsconfig
  plugin entry + `editor.quickSuggestions.strings` + the Tailwind-IntelliSense
  `classRegex` handoff.
- **Packaging — verified.** Ships as the `@shortwind/cli/ts-plugin` *subpath*
  (resolves by name; callable factory; cli bundles the private source). **No new
  published package — stays at 8.**
- **Editor-load — root-caused & fixed.** The plugin loaded fine in the
  programmatic TS LanguageService but **not** in a real editor (Cursor), through
  multiple layers: (1) it loads only under the *workspace* TypeScript, not the
  editor's bundled copy; (2) under pnpm, tsserver resolves the plugin from the
  isolated `.pnpm` store, not the project (TS#42688). After clearing both (flat
  npm install + workspace TS), it *still* failed — the real blocker: **tsserver
  resolves plugin names with classic node10 resolution, which ignores the
  package.json `exports` map.** A subpath that existed only via `exports`
  (`dist/ts-plugin.cjs`) can never resolve in any editor. Fix: ship the plugin as
  a real **`ts-plugin/` directory** with its own `package.json` `main`, so
  classic resolution (`ts-plugin/package.json` → main) finds it. Proven by
  replicating tsserver's exact `resolveModuleName(..., NodeJs)` call from the
  candidate dir — now resolves to `ts-plugin/ts-plugin.cjs` and the factory
  loads. Works with a flat node_modules (npm/yarn); pnpm still needs the
  `pluginPaths` best-effort or a Phase-2 extension.
- **Phase 1b — landed (diagnostics).** Added `looksLikeRecipeToken` to `core`
  (variant-safe: rejects Tailwind's `@container`/`@md:flex`/`@min-[400px]:grid`),
  shared by the plugin's **unknown-recipe diagnostic + did-you-mean quick-fix**
  and `cli lint`'s `recipe/unknown` (which it also hardens — lint no longer
  false-flags Tailwind variants).
- **Still pending.** The ESLint `^@` whitelist wiring (auto-editing arbitrary
  eslint flat configs is unsafe — likely a detect-and-print hint); extracting
  the *remaining* lint rules (redundant/conflicting/suffix) into `core` for the
  lower-priority editor diagnostics; and a real-editor smoke (the programmatic
  harness exercises the exact tsserver API, but VS Code lighting up is the one
  thing not coverable headless).

## Problem

Every DX surface Shortwind has built is **agent-facing**: `SKILL.md`, the
`@guide` blocks, the guessability eval. Agents read the markdown and build clean
apps. But the one time the tool touched a *human's* real codebase
(raymonda.xyz), the human-facing experience was "read a markdown file and type
the recipe names carefully." There is no completion, no hover-to-expand, no
typo squiggle.

The guessability eval is the tell: we built a CI gate to *measure* whether a name
is guessable — which is exactly the problem an editor solves directly. For
humans, an editor that completes `@bad` → `@badge`, hovers it to show the
expansion, and squiggles `@badge-succes` makes the ≥90%-guessable target moot
(it's 100% in-editor). This is the missing half of the DX, and a prerequisite
for putting Shortwind in front of real developers: a recipe system with no
editor support feels *worse* than plain Tailwind, which at least ships official
IntelliSense.

## Thesis: split along the recipe → utility boundary

Editor support divides at exactly the seam the runtime already uses — recipes
expand to utilities, then hand off to Tailwind. So should the tooling:

| Layer | Provider | Cost |
| --- | --- | --- |
| Recipe **bodies** — the utility lists inside `recipes/*.css` | **Tailwind CSS IntelliSense** (the official extension), via a `classRegex` setting `init` writes | ~0 (one config line) |
| Recipe **tokens** in `class`/`className` — `@badge` completion, hover-to-expand, typo diagnostics, go-to-def | **A Shortwind TS language-service plugin**, reusing `@shortwind/core` | one small package |

We build **only** the recipe-token plugin. The entire utility layer is handed to
Tailwind's existing tooling — mirroring how the runtime hands off at the same
seam.

Why the token layer is irreducibly ours: `@badge` is deliberately **not** a
Tailwind utility (the `@` prefix exists so recipe tokens never collide with
Tailwind's namespace). No Tailwind-IntelliSense config can make it complete
`@badge`; it only knows utilities. So token completion can't be borrowed.

## Why a TS language-service plugin (not an extension) for phase 1

Lowest friction, widest reach for the dominant case:

- It's an npm devDep + one line in `tsconfig.json`
  (`"plugins": [{ "name": "@shortwind/ts-plugin" }]`) — which `init` writes. The
  user installs **no marketplace extension**.
- It rides the editor's **built-in TypeScript** support, so it works in VS Code,
  Cursor, Zed, Neovim, WebStorm — anything that uses the workspace TS server.
- It covers `.tsx`/`.jsx` — the path ~all dogfooding used.
- Limitation: TS-only files. `.astro`/`.vue`/`.css` usage isn't covered — that's
  phase 2 (LSP), built only if demand appears.

## Prior art (grounding research, 2026-06-13)

- **The approach is proven.** [`tw-in-js/typescript-plugin`](https://github.com/tw-in-js/typescript-plugin)
  / [`@twind/typescript-plugin`](https://www.npmjs.com/package/@twind/typescript-plugin)
  is a working reference of exactly phase 1: completion + hover (generated CSS,
  theme values, px) + diagnostics, inside JSX `className`/`class`/`tw` strings,
  with **just the `tsconfig` plugins entry — no companion extension required**,
  in any TS-powered editor. Phase-0 check #2 is effectively pre-answered.
- **UnoCSS** "shortcuts" are the same concept as recipes. Their tooling went the
  **full-extension + custom engine** route (not a TS plugin, not Tailwind reuse)
  — confirming named aliases need bespoke tooling — and *still* has gaps
  ([shortcuts outside the main config get no IntelliSense](https://github.com/unocss/unocss/issues/3000)).
  The heavier path is heavier *and* leakier: supports our "TS-plugin first,
  LSP/extension only if needed" phasing, and points at a differentiator
  (complete recipe-token coverage where UnoCSS is partial).
- **Tailwind IntelliSense won't complete recipe tokens** — confirmed; even
  custom classes in `@layer components/utilities` often don't surface
  ([#227](https://github.com/tailwindlabs/tailwindcss-intellisense/issues/227),
  [#230](https://github.com/tailwindlabs/tailwindcss-intellisense/issues/230)).
  The recipe-token layer is irreducibly ours; the recipe-*body* `classRegex`
  handoff is unaffected.

## Phase 0 — de-risk first (a day)

1. **Auto-trigger inside strings (the real gotcha).** VS Code does **not**
   auto-trigger completion inside string literals by default, and a TS plugin
   *cannot* add trigger characters (plugins only augment editing). The fix is a
   VS Code setting — `"editor.quickSuggestions": { "strings": true }` — which
   `init` writes into the `.vscode/settings.json` it already generates. Confirm
   completion fires inside `className="…"` once that setting is present (Twind
   documents this exact workaround). Without it, completion is `Ctrl+Space`-only.
2. **Tailwind-IntelliSense coexistence.** Confirm Tailwind CSS IntelliSense does
   not *flag* `@badge` in `className` as invalid (the extension's lint is
   conflict-focused, not unknown-class-focused — almost certainly fine).
3. **ESLint coexistence (new — surfaced by research).** Tailwind ESLint plugins
   DO flag recipe tokens: `tailwindcss/no-custom-classname` (and
   `eslint-plugin-better-tailwindcss`, which raymonda.xyz uses) report `@badge`
   as "not a Tailwind class." Confirm the fix — whitelist `^@` tokens in the
   rule config — and make it an `init`/docs workstream (see Phase 1).

## Phase 1 — `@shortwind/ts-plugin`

A TypeScript language-service plugin. Each feature maps to a function that
already exists:

| Feature | Reuses |
| --- | --- |
| **Completion** of `@recipe` names in `class`/`className`/`class:list` string positions (and `clsx`/`cva`-style call args) | `Registry.flattened` keys; the lint `extractClassUsages` context detection |
| **Hover**: `@badge → inline-flex items-center rounded-full bg-[var(--tone-bg)]…` + the recipe description and its family `@guide` | `expandClassList` / `registry.flattened`; recipe `.description`; `registry` guidance |
| **Diagnostics**: unknown recipe, dynamic-class warning, redundant utility, conflicting intent, bad suffix order, sibling overlap | the existing lint rule functions (see "Where the rules live") |
| **Quick-fix / did-you-mean** on an unknown recipe (`@badge-succes` → `@badge-success`) | the eval's `resolveGuess` (grammar rewrites + edit-distance) |
| **Go-to-definition** from a `@recipe` token to its `@recipe` block in `recipes/*.css` | `parseRecipeFile` already tracks recipe positions |

Mechanics:

- Load the registry from the file's project (`shortwind.config.json` →
  `recipesDir`), via `loadRegistryFromDir`. Cache it; invalidate on `recipes/*`
  change (mtime signature, the same trick the Next/Vite loaders use).
- The plugin is an **adapter** (does IO through the TS language-service host).
  It must not be imported by `core`/`tailwind`; it depends on them. New package
  `packages/ts-plugin`, arrow `ts-plugin → tailwind → core`.

### What `init` wires (all into files it already generates)

Three lines, zero new files, no marketplace extension:

1. `tsconfig.json` → `"plugins": [{ "name": "@shortwind/ts-plugin" }]` — turns
   on the plugin.
2. `.vscode/settings.json` → `"editor.quickSuggestions": { "strings": true }` —
   without this, recipe completion only fires on manual `Ctrl+Space` (TS plugins
   can't add trigger characters; this is the documented Twind workaround).
3. ESLint whitelist for `@`-tokens **if** a Tailwind ESLint plugin is detected
   (`eslint-plugin-tailwindcss` / `eslint-plugin-better-tailwindcss`): otherwise
   `tailwindcss/no-custom-classname` flags every `@badge` as "not a Tailwind
   class." Whitelist `^@` (or disable the rule for recipe tokens). Document the
   manual form for configs `init` can't safely edit.

The package itself is a devDep (added alongside `@shortwind/cli` per #97).

### Where the rules live (one refactor this forces)

The lint rules (`checkDynamicClass`, `checkRedundantUtility`,
`checkConflictingIntent`, `checkSiblingOverlap`, `checkUsageSuffixOrder`,
`recipe/unknown`) currently live in `@shortwind/cli`. The plugin needs them, and
`ts-plugin → cli` would be an adapter→adapter arrow the architecture doesn't
allow. The rules are **pure** (registry + source → diagnostics); only the
file-walking around them is IO. So: **extract the pure rule functions into
`@shortwind/core`** (or a shared `@shortwind/lint` consumed by both), leave the
glob/read in the cli command. Then cli's `lint` and the ts-plugin share one
implementation and can't drift — and the dependency arrows stay inward. This is
a healthy refactor regardless.

## The Tailwind-IntelliSense handoff (config only)

`init` adds to `.vscode/settings.json` (which it already generates) a
`tailwindCSS.experimental.classRegex` entry that matches the inside of
`@recipe <name> { … }` blocks in `recipes/*.css`. Result: authoring a recipe
body gets Tailwind's full completion, hover-CSS, and color swatches — from the
extension the user almost certainly already has. We ship a setting, not code.

(If the user lacks the Tailwind extension, recipe authoring degrades to plain
text — no worse than today; the ts-plugin's token features are unaffected.)

## Phase 2 — LSP (conditional)

Only if `.astro`/`.vue`/`.css`/`.html` recipe usage turns out to matter. A
single language-server binary reusing the same `@shortwind/core` +
extracted-rules surface, plus thin clients: a VS Code extension, and a few lines
of LSP config for Zed/Neovim/Helix. Same brain, more file types, more client
surface to maintain. Defer until phase 1 proves the value and someone actually
needs non-TS completion.

## Acceptance

- Phase 0 both checks pass.
- Phase 1: in a TSX file in a Shortwind project, typing `@` in `className`
  completes recipe names; hover shows the expansion + guide; an unknown recipe
  squiggles with a did-you-mean fix; go-to-def opens the recipe block — with the
  plugin added only via `tsconfig`, no marketplace extension.
- The eval's guess corpus is reused as plugin completion/quick-fix tests: every
  `GUESSES` entry must complete or quick-fix to its `expected` recipe. The
  guessability gate becomes "the editor lands it," not "the model guesses it."

## Open questions

1. `@shortwind/lint` as its own package vs. folding the pure rules into `core`?
   (Lean: into `core` — they're pure functions over registry+source, which is
   core's remit; avoids a new package.)
2. Hover showing *resolved CSS* (not just the utility list) needs Tailwind
   generation — defer to phase 2; the utility list is enough and trivial.
3. Multi-root / monorepo: resolve `recipesDir` per source file's nearest
   `shortwind.config.json`.
