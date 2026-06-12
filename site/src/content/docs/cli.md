---
title: CLI reference
description: Every shortwind command and its flags.
order: 6
---

# CLI reference

The CLI ships as **`@shortwind/cli`** (beta) and provides the `shortwind` command.
Run it one-off with `npx @shortwind/cli@beta <command>`, or install it
(`npm i -D @shortwind/cli@beta`) to use the `shortwind` command in scripts. The
commands below assume it's installed.

## `shortwind new <family>`

Scaffold a new custom recipe family file (`recipes/<family>.css`) with a header,
an `@guide` stub, and an example recipe, then regenerate `SKILL.md`.

## `shortwind init`

Scaffold Shortwind in the current project: detects your bundler, writes a
config, copies recipes, scaffolds the theme, and generates `SKILL.md`. On
**Vite** it also patches the plugin into `vite.config.*`; on **Next/Astro** it
prints the one-line snippet to paste instead.

Interactive by default (it prompts for a preset). Pass `--preset <name>` to
pick one explicitly, or `--yes`/`-y` to take the default (`starter`) — both
skip the prompt, so agents and CI can run `init` unattended.

## `shortwind add <family...>`

Copy one or more families from the registry into `recipes/`. Updates
`SKILL.md` and the lockfile.

## `shortwind remove <family...>`

Delete one or more families. Updates `SKILL.md` and the lockfile.

## `shortwind preset <name>`

Apply a curated set of families. Built-in presets are `starter`, `app`,
`content`, and `all`.

## `shortwind ls [--family <name>]`

List installed recipes. Filter by family. Useful in scripts.

## `shortwind build`

One-shot: parse all recipes, resolve, expand a target file or stdin to plain
Tailwind, and write to stdout (or `--out`).

## `shortwind dev`

Watcher: re-runs `build` on every recipe change. Useful when authoring new
recipes.

## `shortwind upgrade [...families]`

Bump installed recipes to the latest registry versions. Flags: `--check` for
dry run, `--force` to overwrite touched files.

## `shortwind verify`

Read-only audit of the lockfile against installed files. Exits non-zero on
mismatch. CI-friendly.

## `shortwind doctor`

Run after your framework's production build. Scans the build output (`.next/`,
`dist/`, `out/`, `build/` — or `--dir <path>`) for raw `@recipe` tokens that
survived to the emitted HTML/JS, and tells the two failure modes apart:

- **No transform ran** — every recipe your source references is still raw.
  The adapter isn't wired (e.g. `withShortwind()(config)` missing from
  `next.config`). `strict` mode can't catch this case: it lives inside the
  adapter, so it never fires if the adapter never runs.
- **Transform ran but tokens leaked** — only some tokens are raw, typically a
  `className` built from a variable/prop/template. See
  [dynamic classes](/docs/dynamic-classes).

Exits non-zero on findings (`2` when there is no build output to scan), so it
slots into CI right after the build step. `--json` for machine-readable
output. The documented `rc()` runtime escape hatch is exempt.

## `shortwind lint`

Diagnostic pass over `recipes/` and your source files. Reports cycles,
duplicates, unknown references, unused recipes, redundant utilities, and
dynamic recipe names.

By default lint scans `src/`, plus root-level `app/`, `pages/`, `components/`
and `lib/` (the common Vite and Next layouts, with or without `src/`). If your
sources live elsewhere, set `"content"` in `shortwind.config.json`:

```json
{
  "content": ["packages/web/**/*.{ts,tsx,astro}"]
}
```

or pass `--content <glob>` (repeatable; overrides the config). When the scan
matches no files, usage rules such as `recipe/unused` are skipped and lint
warns instead of reporting every recipe as unused. Other flags: `--fix`,
`--rule <name>` (repeatable), `--json`.
