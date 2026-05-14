# CLI — `build` and `dev` (watcher)

## Scope

Local development loop that keeps `SKILL.md` in sync with `./recipes/`.

## `shortwind build`

- One-shot. Reads every `.css` in `./recipes/`, parses, resolves, regenerates `skills/shortwind/SKILL.md`.
- Idempotent. Fails non-zero on any parse error, cycle, or unknown reference.

## `shortwind dev`

- Watches `./recipes/` via `chokidar`.
- On change: re-parse, re-resolve, re-write `SKILL.md`. Print a one-line status (`✓ regenerated 4 families`).
- Print errors to stderr; keep watching after errors.
- Optional `--once` flag aliases to `build`.

## Pre-commit hook (installed by `init`)

- Runs `shortwind build`.
- Stages `skills/shortwind/SKILL.md` if it changed.
- Fails the commit if any error occurs.

## Tests (light)

- Smoke: change a recipe in a tmp dir, watcher re-runs build, output file content matches expected.
- Build fails non-zero on parse error.
- Build is a no-op when `SKILL.md` is already current (no rewrite, no file mtime change).

## Out of scope

- Bundler-plugin file watching (handled by the plugins themselves in 11/12/13).
