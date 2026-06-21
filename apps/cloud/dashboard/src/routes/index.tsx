import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Index → route to the dashboard when signed in, else to login. The `_authed`
 * gate guards the dashboard itself; this just picks the landing destination.
 */
export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.isAuthenticated ? "/dashboard" : "/login" });
  },
});
