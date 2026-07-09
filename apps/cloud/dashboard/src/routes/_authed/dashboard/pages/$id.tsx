import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectDetail, isDetailTab } from "@/views/ProjectDetail";
import type { DetailTab } from "@/views/ProjectDetail";

/**
 * Page detail route (#212) — a single hosted page at
 * `/cloud/dashboard/pages/<id>`, a real shareable URL (was Overview-internal
 * state). The active detail tab is the `?tab=` search param, so a specific
 * tab is deep-linkable too. "Back" returns to the Overview section.
 */
export const Route = createFileRoute("/_authed/dashboard/pages/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: DetailTab } => {
    const tab = search.tab;
    return isDetailTab(typeof tab === "string" ? tab : undefined)
      ? { tab: tab as DetailTab }
      : {};
  },
  component: PageDetailRoute,
});

function PageDetailRoute() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <ProjectDetail
      pageId={id}
      tab={tab ?? "overview"}
      onTabChange={(next) =>
        navigate({
          to: "/dashboard/pages/$id",
          params: { id },
          search: { tab: next === "overview" ? undefined : next },
        })
      }
      onBack={() =>
        navigate({ to: "/dashboard/$section", params: { section: "overview" } })
      }
    />
  );
}
