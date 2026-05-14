# CLI — `add`, `remove`, `preset`, `ls`

## Scope

Family-level catalog management commands.

## `shortwind add <family>...`

- Fetches `<family>.css` from the registry (current version).
- Writes to `recipes/<family>.css` with the fingerprint header.
- Updates `recipes/.shortwind-lock.json`.
- Regenerates `SKILL.md`.
- If a family is referenced by another already-installed family (cross-family `@references`), warns and offers to install the dependency.
- `--as <new-name>` rewrites the file *and* every `@<family>-*` recipe inside it to `@<new-name>-*`. Used for collision avoidance.
- `--all` installs every family in the registry.
- `--force` overwrites an existing file (with a confirmation prompt unless `--yes`).

## `shortwind remove <family>...`

- Deletes `recipes/<family>.css`.
- Updates lockfile.
- Regenerates `SKILL.md`.
- Warns if other installed families reference recipes from the one being removed.

## `shortwind preset <name>`

- Additive — installs every family in the named preset that isn't already present.
- Never auto-removes families that are installed but not in the new preset (user runs `remove` explicitly).

## `shortwind ls`

- Prints two columns: installed families (with versions from lockfile), and available families from the registry.
- `--available` shows only registry families.
- `--installed` shows only installed.
- `--json` for scripting.

## Tests (medium)

- `add` writes the file, updates lockfile, regenerates `SKILL.md`. All against a mocked HTTP registry.
- `add --as` rewrites both the filename and the in-file recipes.
- `remove` is the inverse.
- `preset` is additive (no destructive surprise).
- `ls` output formats stable enough for snapshot.

## Out of scope

- Versioned `add` (pin to a specific recipe version) — phase 2; for now `add` always pulls latest. The lockfile records what was installed.
