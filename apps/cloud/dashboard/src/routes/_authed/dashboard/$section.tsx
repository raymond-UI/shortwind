import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { PagesView } from "@/views/PagesView";
import { AuditView } from "@/views/AuditView";
import { RecipeEditsView } from "@/views/RecipeEditsView";
import { ModerationView } from "@/views/ModerationView";
import { UsageView } from "@/views/UsageView";
import { BillingView } from "@/views/BillingView";
import { AnalyticsView } from "@/views/AnalyticsView";
import {
  SettingsView,
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
} from "@/views/SettingsView";
import type { SettingsTab } from "@/views/SettingsView";
import { EmptyState } from "@/components/EmptyState";

/**
 * Dashboard section route (#212) — the active section is the URL segment
 * `/cloud/dashboard/<section>`, rendered into the layout's `<Outlet/>`. Each
 * section maps to a single view; Overview drills into a page's detail by
 * navigating to `/cloud/dashboard/pages/<id>` (a real, shareable URL) and
 * Activity is the audit + recipe-edit feed pairing (PRD §5.4). Settings carries
 * its active sub-page in the `?tab=` search param so it is shareable/reloadable.
 */
const KNOWN_SECTIONS = [
  "overview",
  "analytics",
  "usage",
  "billing",
  "activity",
  "moderation",
  "settings",
] as const;

export const Route = createFileRoute("/_authed/dashboard/$section")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const tab = search.tab;
    return typeof tab === "string" &&
      (SETTINGS_TABS as readonly string[]).includes(tab)
      ? { tab: tab as SettingsTab }
      : {};
  },
  loader: ({ params }) => {
    if (!KNOWN_SECTIONS.includes(params.section as (typeof KNOWN_SECTIONS)[number])) {
      throw notFound();
    }
  },
  notFoundComponent: () => (
    <EmptyState
      icon="∅"
      title="Section not found"
      description="That dashboard section doesn’t exist."
    />
  ),
  component: SectionRoute,
});

function SectionRoute() {
  const { section } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  switch (section) {
    case "overview":
      return (
        <PagesView
          onOpen={(id) =>
            navigate({ to: "/dashboard/pages/$id", params: { id } })
          }
        />
      );
    case "analytics":
      return (
        <AnalyticsView
          onOpenPage={(id) =>
            navigate({ to: "/dashboard/pages/$id", params: { id } })
          }
        />
      );
    case "usage":
      return <UsageView />;
    case "billing":
      return <BillingView />;
    case "activity":
      return <ActivitySection />;
    case "moderation":
      return <ModerationView />;
    case "settings":
      return (
        <SettingsView
          tab={tab ?? DEFAULT_SETTINGS_TAB}
          onTabChange={(next: SettingsTab) =>
            navigate({
              to: "/dashboard/$section",
              params: { section: "settings" },
              search: { tab: next === DEFAULT_SETTINGS_TAB ? undefined : next },
              replace: true,
            })
          }
        />
      );
    default:
      return null;
  }
}

/** Activity = the audit feed + the distinct recipe-edit feed (PRD §5.4). */
function ActivitySection() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="@eyebrow">Audit log</h2>
        <AuditView />
      </section>
      <section className="space-y-3">
        <h2 className="@eyebrow">Recipe edits</h2>
        <RecipeEditsView />
      </section>
    </div>
  );
}
