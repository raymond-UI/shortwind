# Monorepo bootstrap — turbo, pnpm workspace, tsconfig base

## Scope

Wire up the empty scaffolded monorepo so every package can build, typecheck, and run scripts via `turbo`. The directory skeleton already exists (`apps/web/`, `packages/{core,tailwind,vite,next,astro,registry,cli}/`); this issue fills in shared config.

## Deliverables

- Root `tsconfig.base.json` with strict settings (TS 6, ESM, NodeNext module resolution, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Per-package `tsconfig.json` extending the base, with package-specific `outDir` and `references` for project references.
- Working `pnpm install` against the root.
- Working `turbo run build` and `turbo run typecheck` (no-ops at this stage are fine — they should at least walk the graph without error).
- `.editorconfig`, `.prettierrc`, and a single shared lint config.
- README in `docs/` linking to the PRD.

## Acceptance criteria

- Fresh clone + `pnpm install` succeeds.
- `turbo run typecheck` walks every package and reports zero errors.
- No dependency loosening — all pins from the existing `package.json` files remain intact.

## Non-goals

No source code in any `@shortwind/*` package yet. Just the build wiring.
