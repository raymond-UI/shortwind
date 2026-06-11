---
title: Upgrade flow
description: Fingerprints, the lockfile, and shortwind upgrade.
order: 5
---

# Upgrade flow

Recipes are versioned. The default Shortwind catalog ships at v0 — when a
recipe changes, its version bumps and its `sha` rotates.

## Three states

When `shortwind upgrade` looks at a recipe file, it compares the file's body
sha to the lockfile's recorded sha. There are three outcomes:

- **Pristine.** Body sha matches the lockfile and the on-disk header sha.
  The upgrade applies cleanly.
- **Touched.** Body sha differs from the lockfile sha — you've edited it.
  The CLI prompts: keep your version, accept the upstream, or skip.
- **Unchanged.** You're already on the latest version. Nothing to do.

## The lockfile

`shortwind.lock.json` records the installed family/version/sha trio. It is
machine-managed but human-readable. The CLI guarantees:

- Every installed family appears in the lockfile.
- The lockfile sha matches the file body sha (after CRLF normalization).
- The header sha on disk matches both.

`shortwind verify` runs the same checks read-only — useful in CI.

## --check and --force

- `shortwind upgrade --check` — report what would change without writing.
- `shortwind upgrade --force` — overwrite touched files without prompting.
  Reserved for CI bots that own the recipes directory.
