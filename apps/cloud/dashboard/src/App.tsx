import { useState } from "react";
import { PagesView } from "./views/PagesView";
import { AuditView } from "./views/AuditView";
import { RecipeEditsView } from "./views/RecipeEditsView";
import { ModerationView } from "./views/ModerationView";
import { PolicyView } from "./views/PolicyView";

/**
 * Dashboard shell (CLOUD-35). Five oversight views behind a tab switcher:
 * Pages, Audit log, Recipe edits (the distinct §5.4 feed), Moderation, Policy.
 *
 * Data flows in through the `DashboardDataProvider` (wired by `main.tsx` to
 * Convex, or by tests to fixtures), so this shell is pure presentation and
 * fully renderable offline / under jsdom.
 */
const TABS = [
  { id: "pages", label: "Pages", render: () => <PagesView /> },
  { id: "audit", label: "Audit log", render: () => <AuditView /> },
  { id: "recipes", label: "Recipe edits", render: () => <RecipeEditsView /> },
  { id: "moderation", label: "Moderation", render: () => <ModerationView /> },
  { id: "policy", label: "Policy", render: () => <PolicyView /> },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App({ initialTab = "pages" }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Shortwind Cloud</h1>
        <span className="sub">human oversight</span>
      </header>
      <nav className="tabs" aria-label="Oversight views">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            aria-current={t.id === tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main>{active.render()}</main>
    </div>
  );
}
