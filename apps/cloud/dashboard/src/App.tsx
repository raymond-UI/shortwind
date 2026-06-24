import { useState } from "react";
import { PagesView } from "./views/PagesView";
import { ProjectDetail } from "./views/ProjectDetail";
import { AuditView } from "./views/AuditView";
import { RecipeEditsView } from "./views/RecipeEditsView";
import { ModerationView } from "./views/ModerationView";
import { PolicyView } from "./views/PolicyView";
import { UsageView } from "./views/UsageView";
import { DomainsView } from "./views/DomainsView";
import { AnalyticsView } from "./views/AnalyticsView";
import { SettingsView } from "./views/SettingsView";
import { ThemeToggle } from "./components/ThemeToggle";

/**
 * Dashboard shell (epic #184) — an owner-first hosting console (Vercel/Cloudflare
 * Pages style): a left sidebar over the section views. Section nav is internal
 * state (not URL routes) so the whole tree stays renderable offline / under
 * jsdom through the `DashboardDataProvider` seam — the same testability story the
 * views already rely on.
 *
 * Sections map to owner concerns: Overview (your pages), Analytics, Domains,
 * Usage, Activity (audit + recipe edits), Moderation (your own flagged pages),
 * Settings (account + policy + API tokens). There is no platform-admin role yet
 * (auth is account-scoped; cross-account operator deferred to #160), so every
 * section shows only the signed-in account's own data.
 */
const SECTIONS = [
  { id: "overview", label: "Overview", render: () => <OverviewSection /> },
  { id: "analytics", label: "Analytics", render: () => <AnalyticsView /> },
  { id: "domains", label: "Domains", render: () => <DomainsView /> },
  { id: "usage", label: "Usage", render: () => <UsageView /> },
  { id: "activity", label: "Activity", render: () => <ActivitySection /> },
  { id: "moderation", label: "Moderation", render: () => <ModerationView /> },
  { id: "settings", label: "Settings", render: () => <SettingsView /> },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Overview: the page-card grid, drilling into a single page's detail. */
function OverviewSection() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) {
    return <ProjectDetail pageId={selected} onBack={() => setSelected(null)} />;
  }
  return <PagesView onOpen={setSelected} />;
}

/** Activity = the audit feed + the distinct recipe-edit feed (PRD §5.4). */
function ActivitySection() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Audit log
        </h2>
        <AuditView />
      </section>
      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Recipe edits
        </h2>
        <RecipeEditsView />
      </section>
    </div>
  );
}

export function App({
  initialSection = "overview",
  onSignOut,
}: {
  initialSection?: SectionId;
  onSignOut?: () => void;
}) {
  const [section, setSection] = useState<SectionId>(initialSection);
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center gap-2 px-5 py-4">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary text-term"
          >
            ▚
          </span>
          <span className="text-sm font-semibold tracking-tight">shortwind</span>
          <span className="text-xs text-muted-foreground">Cloud</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Dashboard">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === section}
              onClick={() => setSection(s.id)}
              className={
                "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors " +
                (s.id === section
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")
              }
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <ThemeToggle />
          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-sm font-semibold tracking-tight">{active.label}</h1>
        </header>
        <main className="flex-1 overflow-auto p-6">{active.render()}</main>
      </div>
    </div>
  );
}
