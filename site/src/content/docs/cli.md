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

## `shortwind lint`

Diagnostic pass over `recipes/`. Reports cycles, duplicates, unknown
references. Optional `--naming` checks the family-intent-size convention.
