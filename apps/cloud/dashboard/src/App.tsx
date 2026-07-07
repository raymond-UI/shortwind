import { useState } from "react";
import { PagesView } from "./views/PagesView";
import { ProjectDetail } from "./views/ProjectDetail";
import { AuditView } from "./views/AuditView";
import { RecipeEditsView } from "./views/RecipeEditsView";
import { ModerationView } from "./views/ModerationView";
import { PolicyView } from "./views/PolicyView";
import { UsageView } from "./views/UsageView";
import { BillingView } from "./views/BillingView";
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
  { id: "billing", label: "Billing", render: () => <BillingView /> },
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
        <h2 className="@eyebrow">
          Audit log
        </h2>
        <AuditView />
      </section>
      <section className="space-y-3">
        <h2 className="@eyebrow">
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
  const [navOpen, setNavOpen] = useState(false);
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  function go(id: SectionId) {
    setSection(id);
    setNavOpen(false); // close the mobile drawer on navigation
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Mobile drawer backdrop. */}
      {navOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
        />
      ) : null}

      {/* Sidebar: a slide-in drawer below md, a static rail at md+. */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-border bg-card transition-transform md:static md:z-auto md:translate-x-0 " +
          (navOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
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

        <nav
          className="flex-1 overflow-y-auto px-3 py-2"
          aria-label="Dashboard sections"
        >
          <ul className="list-none space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === section ? "page" : undefined}
                  onClick={() => go(s.id)}
                  className={
                    s.id === section
                      ? "@nav-link-active w-full justify-start"
                      : "@nav-link w-full justify-start"
                  }
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
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
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 md:px-6">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
          >
            ☰
          </button>
          <h1 className="@heading-sm">{active.label}</h1>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">{active.render()}</main>
      </div>
    </div>
  );
}
