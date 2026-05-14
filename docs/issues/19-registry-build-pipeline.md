# packages/registry — build pipeline

## Scope

The pre-build step that turns `packages/registry/recipes/` into `apps/web/public/registry/**` ready to be served by the Worker's `ASSETS` binding.

## Output structure

```
apps/web/public/
  expand.js                          # copied from packages/core's browser build
  expand@<version>.js                # immutable version
  registry/
    manifest.json                    # { families: [{ name, version, sha, recipes: [name, description, expansion] }] }
    presets.json                     # copied verbatim from packages/registry/presets.json
    card.css                         # current version of each family
    card@0.4.2.css                   # version-pinned
    card/CHANGELOG.md                # per-family changelog
    button.css
    button@0.3.7.css
    ...
```

## Build script: `packages/registry/build.ts`

1. Read each `.css` in `packages/registry/recipes/`.
2. Parse with `@shortwind/core` (sanity check — error on parse failure).
3. Build registry (sanity check — error on cycle, unknown ref, duplicate name).
4. For each family:
   - Compute sha256 of body, take first 6 chars.
   - Read version from `packages/registry/recipes/<family>.version` (sibling file) or default `0.0.1`.
   - Write `<family>.css` (with fingerprint header injected/rewritten).
   - Write `<family>@<version>.css` (immutable copy).
   - Append to `manifest.json`.
5. Copy `presets.json`.
6. Copy `packages/registry/changelogs/<family>.md` → `apps/web/public/registry/<family>/CHANGELOG.md`.
7. Copy `packages/core/dist-browser/expand.js` → `apps/web/public/expand.js` and `expand@<version>.js`.

## Versioning workflow (for maintainers)

- Edit `packages/registry/recipes/<family>.css`.
- Bump `packages/registry/recipes/<family>.version`.
- Append to `packages/registry/changelogs/<family>.md`.
- Open a PR. CI runs `pnpm --filter @shortwind/registry build`. Site deploys on merge.

## Tests

- Build is deterministic: same inputs produce byte-identical outputs across runs.
- Manifest JSON is valid against a schema.
- Every family in `presets.json` exists in the manifest.
- Per-family CHANGELOG.md exists.
- Smoke: building against a fixture with intentional parse error fails the build.

## Out of scope

- Publishing to npm (registry is HTTP-served, not npm-distributed).
- Auto-incrementing versions (maintainer bumps manually for clarity).
