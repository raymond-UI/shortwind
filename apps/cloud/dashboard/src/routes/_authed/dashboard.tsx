import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { ConvexDataProvider } from "@/convex/provider";
import { App } from "@/App";

/**
 * The oversight dashboard (CLOUD-35 + CLOUD-43), behind the `_authed` gate.
 * Reuses the presentational `App` shell (tab switcher over the six views) and
 * feeds it live data via `ConvexDataProvider`, which authenticates with the
 * operator's SESSION (no baked bearer). Sign-out clears the session and returns
 * to /login.
 */
export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const router = useRouter();

  async function onSignOut() {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  return (
    <ConvexDataProvider>
      <App onSignOut={onSignOut} />
    </ConvexDataProvider>
  );
}
