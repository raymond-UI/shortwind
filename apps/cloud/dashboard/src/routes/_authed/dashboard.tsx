import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { ConvexDataProvider } from "@/convex/provider";
import { App, isSectionId } from "@/App";

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

  // Deep-link a section via `?section=` (e.g. Stripe checkout returns to
  // `…/cloud/dashboard?section=billing&checkout=success`). Unknown/absent →
  // the default Overview. Read from the URL so a redirect lands on the view.
  const param =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("section")
      : null;
  const initialSection = isSectionId(param) ? param : "overview";

  return (
    <ConvexDataProvider>
      <App initialSection={initialSection} onSignOut={onSignOut} />
    </ConvexDataProvider>
  );
}
