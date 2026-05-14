# Security policy + CI gates

## Scope

Wire the defensive posture documented in the README into CI so it can't be silently undone.

## CI checks (GitHub Actions or equivalent)

- **`pnpm audit`** — fails the build on any high or critical advisory. Reviews required to bump the threshold.
- **`pnpm install --frozen-lockfile`** — fails if lockfile is missing or stale relative to `package.json` ranges.
- **Pin lint** — a small script that scans `package.json` files and fails if `@tanstack/react-router` or `@tanstack/react-start` is specified with `^` or `~`. List is extendable as new active threats emerge.
- **`pnpm.minimumReleaseAge` enforcement** — verify the root `package.json` still has it set to ≥ 4320 (72h). Lowering requires PR approval.
- **`shortwind verify`** — confirm `recipes/.shortwind-lock.json` matches the on-disk recipe shas. (Only relevant once recipes exist in the repo; gate guarded by file existence.)
- **Socket.dev integration** (optional, via marketplace action) — fails on new transitive deps with known supply-chain indicators.

## SECURITY.md

- Documented response policy: who to contact, expected response time, public disclosure window.
- Reference the README "Security posture" section as the source of truth on dep pinning.

## Tests

- CI smoke: a PR that loosens a `@tanstack/*` pin fails the pin-lint check.
- A PR that lowers `minimumReleaseAge` fails the policy check.

## Out of scope

- Bug-bounty program.
- Penetration testing of the live site (v1 site is static — minimal attack surface).
