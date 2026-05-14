# Security policy

## Reporting a vulnerability

Email **security@shortwind.dev** with:

- A description of the issue and its impact.
- Steps to reproduce, including affected versions.
- Any proof-of-concept code (please do not file public issues for unpatched vulnerabilities).

If you want to encrypt the report, fetch the latest PGP public key from
<https://github.com/shortwind/shortwind/security/advisories> (linked at the
top of the advisory list). The fingerprint is published there so that a
mailbox compromise alone cannot trick reporters into using an attacker key.

We will acknowledge within **3 business days** and aim to ship a fix or
mitigation within **30 days** for high-severity issues. Once a fix is shipped
we will publish an advisory on the GitHub Security tab and credit reporters
who request it.

## Supported versions

We patch the latest minor release of each `0.x` line. Older minors are
end-of-life.

## Defensive posture

The npm ecosystem has been hit by several large-scale supply-chain attacks
(Shai-Hulud, qix, Mini Shai-Hulud). Shortwind's defaults assume the next
attack is imminent. See [`README.md` § Security posture](./README.md#security-posture)
for the full rationale.

CI gates that enforce the policy live in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Gate | What it does | Script |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Fails on lockfile drift. | built-in |
| `pnpm audit --audit-level=high` | Fails on any high or critical advisory. | built-in |
| Exact-pin policy | Refuses `^`/`~` ranges on `@tanstack/react-router` and `@tanstack/react-start`. | `pnpm check:pins` |
| Release-age policy | `pnpm.minimumReleaseAge` must remain ≥ 4320 minutes (72 h). | `pnpm check:release-age` |
| Dependency direction | Arrows between workspace packages point inward only. | `pnpm check:deps` |

Loosening any of these gates requires a deliberate PR with a written
justification and at least one reviewer with security context.

### `minimumReleaseAgeExclude`

The root `package.json` exempts the in-repo `@shortwind/*` packages from the
72-hour release-age cool-down. These names are consumed via `workspace:*`
specifiers during local development; the exemption exists so a freshly
published Shortwind release doesn't block its own release tooling.

If a compromised npm publish token were used to push a malicious version of
one of these packages, the exemption would let it install immediately rather
than waiting 72 hours. Mitigations:

- Workspace consumers use `workspace:*` and never read from the registry.
- The exemption is scoped to a fixed allowlist; no glob or `@shortwind/*`
  wildcard. Adding a new name requires a PR edit reviewable here.
- Production releases additionally validate the `provenance` attestation
  before going live (see release runbook).

## Disclosure

We follow coordinated disclosure. Public advisories go out **after** users
have had a reasonable window to upgrade (typically 7 days for low/medium,
72 hours for high/critical that already have a patch).
