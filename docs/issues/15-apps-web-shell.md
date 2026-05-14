# apps/web — TanStack Start shell on Cloudflare Workers

## Scope

The `shortwind.dev` site shell. TanStack Start + Vite + React 19 + Tailwind v4 + Cloudflare Workers. Inherits conventions from `templates/convex-tanstack-saas-starter` minus Convex (we don't need a backend).

## Routes (skeleton only — content in later issues)

- `/` — landing (16)
- `/docs` — docs index (18)
- `/docs/$slug` — docs detail (18)
- `/catalog` — recipe browser (16)
- `/playground` — live shorthand playground (17)

## Deliverables

- Minimal TanStack Router setup with the routes above as placeholders ("coming soon").
- Root layout with header (logo, nav), footer (links).
- `vite.config.ts` wires `@cloudflare/vite-plugin`, `@tailwindcss/vite`, React plugin.
- `wrangler.jsonc` (already scaffolded — just ensure it builds and deploys).
- Tailwind v4 config in CSS (`apps/web/src/styles.css` with `@theme`).
- `dev`, `build`, `preview`, `wrangler:dev`, `deploy`, `deploy:production` scripts.
- Local `pnpm dev` serves at `localhost:5173`. `pnpm wrangler:dev` simulates the production Worker on `localhost:3001`.

## Static asset slots (referenced from later issues)

- `apps/web/public/registry/*` — populated by `packages/registry/build.ts` (19).
- `apps/web/public/expand*.js` — populated by CDN expander build (14).

## Tests

- Smoke: `pnpm build` succeeds.
- Smoke: `pnpm wrangler:dev` starts.

## Out of scope

- Page content (later issues).
- Deploy automation (manual `wrangler deploy` for v1; GitHub Actions later).
