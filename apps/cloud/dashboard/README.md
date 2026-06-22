# Shortwind Cloud — Human Oversight Dashboard (CLOUD-35)

A Convex-reactive, **read-mostly** oversight UI for the human OPERATOR (PRD §3).
The operator grants access, sets policy, and oversees the system — authoring is
not their job. This is **not** a publishing UI.

## Stack

Plain **Vite + React** SPA (React 19, Vite 7, `@vitejs/plugin-react`), TanStack
in the dependency set, `convex/react` for reactive queries, Better Auth client
(`@convex-dev/better-auth`) for the operator session. Versions pinned to the
nyxe-mail / Togethr reference projects. A static SPA (not TanStack-Start SSR) so
it **builds + component-tests fully offline**, before any live deployment.

It is its **own pnpm workspace** (`pnpm-workspace.yaml`, `packages: []`) so its
React/Vite/test deps never touch the convex-side `apps/cloud/package.json`.

## Views

| View          | Source                              | PRD  |
| ------------- | ----------------------------------- | ---- |
| Pages         | `src/views/PagesView.tsx`           | §6.3 |
| Audit log     | `src/views/AuditView.tsx`           | §6.3 |
| Recipe edits  | `src/views/RecipeEditsView.tsx`     | §5.4 |
| Moderation    | `src/views/ModerationView.tsx`      | §8   |
| Policy        | `src/views/PolicyView.tsx`          | §3/§7.2 |

**Recipe edits are rendered DISTINCTLY** (amber rail, `recipe edit` tag,
`@card 0.4.0 → 0.5.0, affects N pages on next publish`) — the §5.4 requirement so
the human notices a recipe change and can roll back. Pinned by
`src/views/RecipeEditsView.test.tsx`.

## Data seam

Views consume `useDashboardData()` (`src/lib/data.tsx`), never Convex directly.
- Live: `src/convex/provider.tsx` fills it from `useQuery(api.dashboard.*)`.
- Tests: `src/test/render.tsx` fills it with fixtures — no live deployment, no
  client mock.

Backend queries: `apps/cloud/convex/dashboard.ts` (`listPages`, `listAuditLog`,
`listRecipeEditEvents`, `listModeration`, `getAccountPolicy`, `setAccountPolicy`),
all `requireRead`-guarded + account-scoped.

## Scripts

```
pnpm dev        # vite dev server (port 5179)
pnpm build      # tsc --noEmit && vite build
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run (jsdom + Testing Library)
```

## Wired by CLOUD-30b

- `VITE_CONVEX_URL` — the deployed Convex URL (`main.tsx`).
- `VITE_BETTER_AUTH_URL` — Better Auth origin (`src/convex/auth-client.ts`).
- `VITE_DASHBOARD_BEARER` — the operator's read-scoped `swc_…` bearer
  (`src/convex/provider.tsx`); CLOUD-30b mints a short-lived read bearer for the
  authenticated operator. Until present, queries stay in their loading branch.
