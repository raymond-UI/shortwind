# `cloud/contract` — vendored wire-contract utilities

These modules (`slug`, `scopes`, `lockfile-diff`, `fingerprint`) are **vendored
copies** of `apps/cloud/shared/src/*`. They are pure plain-data helpers (no IO,
no Node built-ins) that the cloud CLI and the cloud server must agree on byte-for-byte
— slug grammar, OAuth scope names, lockfile-diff semantics, recipe body shas.

## Why vendored (and not a single shared module)

The cloud CLI graduated out of `apps/cloud` into the published `@shortwind/cli`
(`shortwind cloud`, see this directory's parent). The server stayed in
`apps/cloud`, which is a **separate pnpm workspace with its own lockfile** and
resolves `@shortwind/core` from the **published registry**, not the local
`packages/core` (it is not a workspace symlink). Given that, the options for a
single source were:

- A new shared package — disallowed (stay at the published-package count).
- Cross-workspace relative imports (`apps/cloud` ⇄ `packages/cli/src`) — breaks
  the self-contained-workspace boundary and the dependency direction.
- Promote into `@shortwind/core` — `slug` (page subdomains) and `scopes` (OAuth)
  are **cloud-domain** concepts that do not belong in the recipe engine; and the
  server could only consume new core exports after a coordinated `@shortwind/core`
  release + an `apps/cloud` dependency bump.

So byte-identical vendoring is the correct pragmatic outcome. `slug`, `scopes`,
and `fingerprint` are kept **identical** to `apps/cloud/shared/src/*` (do not edit
one without the other). `lockfile-diff` is the one exception: it imports the
`Lockfile`/`LockEntry` type from the CLI's canonical `packages/cli/src/lockfile.ts`
instead of re-declaring it, so the CLI has a single lockfile type.

## Future single-sourcing

If/when the recipe-related contract (`lockfile-diff`, `fingerprint`) is promoted
to `@shortwind/core`, it must ship as a coordinated core release that `apps/cloud`
then bumps to — at which point both sides drop their copies. `slug`/`scopes`
would need a cloud-shared home, not the recipe core.
