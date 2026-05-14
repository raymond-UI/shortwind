---
title: CLI reference
description: Every shortwind command and its flags.
order: 6
---

# CLI reference

## `shortwind init`

Scaffold Shortwind in the current project. Interactive — detects your bundler,
writes a config, wires the plugin, generates `SKILL.md`.

## `shortwind add <family...>`

Copy one or more families from the registry into `recipes/`. Updates
`SKILL.md` and the lockfile.

## `shortwind remove <family...>`

Delete one or more families. Updates `SKILL.md` and the lockfile.

## `shortwind preset <name>`

Apply a curated set of families. Built-in presets include `minimal`,
`marketing`, and `dashboard`.

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
