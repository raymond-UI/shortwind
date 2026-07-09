import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/cloud/dashboard` → `/cloud/dashboard/overview` (#212).
 *
 * The bare dashboard URL has no section of its own; it redirects to Overview so
 * the sidebar always has a highlighted item and the URL always names a section.
 */
export const Route = createFileRoute("/_authed/dashboard/")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/$section",
      params: { section: "overview" },
    });
  },
});
