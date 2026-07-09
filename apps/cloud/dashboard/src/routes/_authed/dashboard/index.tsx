import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/cloud/dashboard` → `/cloud/dashboard/overview` (#212).
 *
 * The bare dashboard URL has no section of its own; it redirects to Overview so
 * the sidebar always has a highlighted item and the URL always names a section.
 * `replace: true` so this hop doesn't land in history — otherwise the browser
 * back button would bounce `/overview` → `/dashboard` → `/overview` forever.
 */
export const Route = createFileRoute("/_authed/dashboard/")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/$section",
      params: { section: "overview" },
      replace: true,
    });
  },
});
