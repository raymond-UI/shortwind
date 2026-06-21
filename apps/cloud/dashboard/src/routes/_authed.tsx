import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

/**
 * Auth-gated layout (mirrors nyxe-mail/apps/web/src/routes/_authed.tsx).
 * `isAuthenticated` is session presence, seeded by `__root.beforeLoad`. A
 * logged-out visitor is redirected to /login; everything under this layout is
 * rendered against an authenticated Convex client.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
    }
  },
  component: () => <Outlet />,
});
