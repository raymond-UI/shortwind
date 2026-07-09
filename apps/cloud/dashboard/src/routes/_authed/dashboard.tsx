import { useState } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { ConvexDataProvider } from "@/convex/provider";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Dashboard LAYOUT (#212 — URL-based navigation).
 *
 * The section switcher is now URL-driven: each nav item is a real route
 * (`/cloud/dashboard/<section>`) and a page's detail is
 * `/cloud/dashboard/pages/<id>`. Deep-linkable, browser back/forward works,
 * URLs are shareable. The shell (sidebar + header) renders here; the active
 * section is the CHILD route rendered through `<Outlet/>`. Data still flows via
 * `ConvexDataProvider` (the seam every view reads).
 */
export const NAV = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
  { id: "domains", label: "Domains" },
  { id: "usage", label: "Usage" },
  { id: "billing", label: "Billing" },
  { id: "activity", label: "Activity" },
  { id: "moderation", label: "Moderation" },
  { id: "settings", label: "Settings" },
] as const;

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const params = useParams({ strict: false }) as { section?: string };
  const onPageDetail = router.state.location.pathname.includes("/pages/");
  // Highlight the section from the URL; a page detail lives under Overview.
  const activeId = params.section ?? "overview";
  const activeLabel =
    NAV.find((n) => n.id === activeId)?.label ??
    (onPageDetail ? "Overview" : "Dashboard");

  async function onSignOut() {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  return (
    <ConvexDataProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        {navOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
          />
        ) : null}

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
            <span className="text-sm font-semibold tracking-tight">
              shortwind
            </span>
            <span className="text-xs text-muted-foreground">Cloud</span>
          </div>

          <nav
            className="flex-1 overflow-y-auto px-3 py-2"
            aria-label="Dashboard sections"
          >
            <ul className="list-none space-y-0.5">
              {NAV.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/dashboard/$section"
                    params={{ section: n.id }}
                    onClick={() => setNavOpen(false)}
                    aria-current={n.id === activeId ? "page" : undefined}
                    className={
                      n.id === activeId
                        ? "@nav-link-active w-full justify-start"
                        : "@nav-link w-full justify-start"
                    }
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Sign out
            </button>
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
            <h1 className="@heading-sm">{activeLabel}</h1>
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ConvexDataProvider>
  );
}
