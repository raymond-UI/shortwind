# CLI — `shortwind upgrade` (fingerprint + lockfile)

## Scope

The flow that pulls registry updates into `./recipes/` without clobbering user edits. Improves on shadcn's existing `diff` UX by adding touched-detection.

## Fingerprint header

Each recipe file's first line:

```
/* shortwind: <family>@<version> sha:<6-char-sha256-of-body> — DO NOT EDIT THIS LINE */
```

The sha covers everything after the header line, normalized (trim trailing whitespace, LF line endings). `shortwind add` and `shortwind upgrade` write this header; users don't touch it.

## Lockfile

`recipes/.shortwind-lock.json`:

```json
{
  "version": 1,
  "families": {
    "card": { "version": "0.4.2", "sha": "b0a1c3" },
    "button": { "version": "0.3.7", "sha": "9d12fe" }
  }
}
```

## `shortwind upgrade`

- Read `presets.json` and `manifest.json` from the registry.
- For each installed family:
  - Fetch the current registry version.
  - Compute the recorded local sha (from header) and the actual file sha.
  - **Pristine** (recorded sha == actual sha): if registry version > lockfile version, apply automatically. Print one line.
  - **Touched** (recorded sha != actual sha): show a 3-way diff (yours vs lockfile-baseline vs new registry version). Prompt: accept new / keep yours / show diff again / skip.
  - **Unchanged** (lockfile version == registry version): no-op.
- After each family is resolved, update lockfile.
- After all families processed, regenerate `SKILL.md` once.

## `shortwind upgrade --check`

- Read-only. Exit 0 if no drift, exit 1 if any family has updates available, exit 2 on errors.
- Prints a summary (`3 updates available, 1 touched file would need review`).
- CI-friendly.

## `shortwind upgrade <family>`

- Single family.

## `shortwind upgrade --force`

- Skips touched-detection. Last resort. Prints a warning per touched file.

## `shortwind verify`

- Walks `recipes/` and the lockfile; reports any file whose sha doesn't match what the lockfile claims it should be. Useful as a pre-commit step or CI gate.

## Tests (heavy)

- Pristine update applies cleanly.
- Touched file produces 3-way diff and respects user's choice on each.
- Multiple families at different states (pristine + touched + unchanged) — correct outcomes for each.
- Lockfile update is atomic with file writes (rollback on failure).
- `--check` exit codes match drift state.
- `--force` skips detection.
- `verify` catches manually-edited fingerprint headers (the user can't fool the system by hand-editing the sha).
- Mocked HTTP registry serves both current and pinned versions.

## Out of scope

- Bisecting which recipe inside a family was modified (file-level granularity for v1).
