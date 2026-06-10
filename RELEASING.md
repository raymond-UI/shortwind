# Releasing

Publishing is automated via GitHub Actions and **npm trusted publishing** (OIDC).
There is no `NPM_TOKEN` secret — the workflow proves its identity to npm with a
short-lived OIDC token minted per run, and attaches a build-provenance
attestation. Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml).

## One-time npm setup (per package)

Trusted publishing must be configured **once per package** on npmjs.com before
the first automated publish. Do this for all eight publishable packages:

```
@shortwind/core      @shortwind/runtime   @shortwind/tailwind  @shortwind/registry-catalog*
@shortwind/cli       @shortwind/vite      @shortwind/next      @shortwind/astro
```

\* the catalog publishes under the name `@shortwind/catalog` (directory
`packages/registry`).

For each existing package: **npmjs.com → the package → Settings → Trusted
Publisher → Add** (GitHub Actions), and enter:

| Field             | Value                          |
| ----------------- | ------------------------------ |
| Organization/user | `raymond-UI`                   |
| Repository        | `shortwind`                    |
| Workflow filename | `release.yml`                  |
| Environment       | _(leave blank)_                |

### First publish of a brand-new package

`@shortwind/catalog` has never been published. npm lets you pre-register a
trusted publisher for a not-yet-existing package from your account's **Packages
→ Add package → via trusted publishing** flow — do that and the workflow will
create it on first run. If your npm account doesn't show that option, publish
the catalog **once** manually to create the name, then add the trusted publisher
as above:

```bash
cd packages/registry && pnpm publish --no-git-checks
```

After that one-time bootstrap, every release is hands-off.

## Cutting a release

1. Bump every publishable package to the new version (internal deps stay
   `workspace:*` — pnpm rewrites them at pack time):

   ```bash
   # edits packages/*/package.json version fields only
   node -e 'const fs=require("fs");for(const p of ["next","core","runtime","cli","tailwind","vite","registry","astro"]){const f=`packages/${p}/package.json`;const j=JSON.parse(fs.readFileSync(f));j.version="0.1.0-beta.4";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   ```

2. Commit, then tag with a `v`-prefixed tag **matching the version** and push:

   ```bash
   git commit -am "chore: release 0.1.0-beta.4"
   git tag v0.1.0-beta.4
   git push origin main --tags
   ```

The tag push triggers the workflow. It re-runs typecheck/test/build, guards that
the tag matches the committed version, then packs and publishes all eight
packages with provenance. `publishConfig` in each `package.json` sets
`access: public` and `tag: beta`, so prereleases land on the `beta` dist-tag (not
`latest`).

You can also run it from **Actions → Release → Run workflow** to publish the
currently-committed versions without a tag (the tag/version guard is skipped).

## Notes

- The CLI resolves the catalog via `dist-tags.latest ?? dist-tags.beta`, so beta
  publishes are picked up automatically; promoting to `latest` is optional:
  `npm dist-tag add @shortwind/catalog@<version> latest`.
- Provenance requires a public repo (this one is). If the repo is ever made
  private, drop `--provenance` from the publish step — OIDC auth still works.
