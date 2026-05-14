# CLI — `shortwind lint`

## Scope

Static analysis over the user's source files + their `recipes/` directory. Catches usage mistakes that `tailwind-merge` would silently paper over, plus structural problems in recipe files themselves.

## Rules

| Rule | Severity | Auto-fix? |
|---|---|---|
| `recipe/unknown` — `@name` in source has no matching recipe | error | no |
| `recipe/cycle` — recipe references itself transitively | error | no |
| `recipe/duplicate` — two recipes share a name | error | no |
| `recipe/no-sibling-overlap` — two recipes from same family on one element | warning | no |
| `recipe/conflicting-intent` — `@btn-primary @btn-danger` | warning | no |
| `recipe/no-redundant-utility` — utility re-appended that's already in the recipe | info | yes (drops the dup) |
| `recipe/bad-suffix-order` — `@btn-lg-primary` (size before intent) | warning | yes (reorders) |
| `recipe/dynamic-class` — likely-computed recipe name (`@${variant}`) | warning | no |
| `recipe/unused` — recipe defined in `recipes/` but never referenced in source | info | no |

## Behavior

```
shortwind lint                        # walks src/ and recipes/, prints findings
shortwind lint --fix                  # applies auto-fixes
shortwind lint --rule recipe/unused   # single rule
shortwind lint --json                 # machine-readable output for CI
```

- Walks files matched by `shortwind.config.json` `content` glob (default mirrors Tailwind's content config).
- Exit codes: 0 if no errors, 1 if errors, 2 on internal failure.
- Output format: ESLint-compatible (file:line:col message [rule]).

## Tests (medium)

- Each rule has fixture files: one that should fire, one that should not.
- Auto-fix produces the expected output and is idempotent (running `--fix` twice = same as once).
- `--json` output is stable across runs.

## Out of scope

- A `shortwind format` command (no opinion on Prettier integration for v1).
- IDE diagnostics (LSP-style integration deferred).
