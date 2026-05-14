# CLI — `shortwind init`

## Scope

Interactive bootstrap command that gets a new or existing project from zero to "running Shortwind."

## Behavior

```
shortwind init                       # interactive, prompts for preset
shortwind init --preset=app          # non-interactive
shortwind init --preset=none         # bare bones, no recipes
shortwind init --registry=<url>      # custom registry origin
```

Steps:

1. Detect project shape: package manager (via `detect-package-manager`), Tailwind version (read `package.json`), bundler (Vite / Next / Astro / unknown), framework (React / Vue / Svelte / Astro / plain HTML).
2. Prompt for preset if `--preset` not passed (`@clack/prompts` select).
3. Install the right packages (`@shortwind/<bundler>`, `@shortwind/tailwind`) using the detected package manager.
4. Copy the preset's families from the registry into `./recipes/`.
5. Write `shortwind.config.json` with `registry`, `recipesDir`, `outputPath` for `SKILL.md`.
6. Edit `.vscode/settings.json` (create if missing) — add `tailwindCSS.experimental.classRegex` entry. Use `jsonc-parser` so existing comments survive.
7. Install pre-commit hook (write `.husky/pre-commit` or update if it exists, line is `npx shortwind build`).
8. Generate `skills/shortwind/SKILL.md` for the first time.
9. Print next-step instructions: `pnpm dev` (or detected PM) to start watching.

## Idempotency

- Re-running `init` does not clobber `recipes/`.
- Re-running does ensure plugin wiring, classRegex entry, pre-commit hook, and `SKILL.md` are present and current.
- Detects if the user has already chosen a different preset; offers to skip rather than override.

## Tests (medium)

- Against a tmp dir with each bundler fixture (Vite/Next/Astro/plain HTML): correct files written, correct package installs invoked (mock the package manager).
- Each preset produces the expected `recipes/` tree.
- Idempotency: run twice, second run is a no-op for `recipes/` and a re-sync for everything else.
- `wrangler.jsonc` and `tsconfig.json` survive comment-preserving edits.
- `--preset=none` produces a valid working install with empty `recipes/`.

## Out of scope

- Migrations from existing Tailwind class strings to recipes (later, possibly a `shortwind migrate` command).
