import { useEffect, useRef } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  useParams,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { ConvexDataProvider } from "@/convex/provider";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Dashboard LAYOUT (#212 — URL-based navigation; console redesign).
 *
 * Vercel-style console shell: a top bar (brand + theme/sign-out) over a
 * horizontal tab row — no sidebar. Each tab is a real route
 * (`/cloud/dashboard/<section>`) and a page's detail is
 * `/cloud/dashboard/pages/<id>`. Deep-linkable, browser back/forward works,
 * URLs are shareable. The tab row scrolls horizontally on small screens, so
 * there is no mobile drawer to manage. The active section is the CHILD route
 * rendered through `<Outlet/>`. Data still flows via `ConvexDataProvider`
 * (the seam every view reads).
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
  const params = useParams({ strict: false }) as { section?: string };
  // Highlight the section from the URL; a page detail lives under Overview.
  const activeId = params.section ?? "overview";

  // Mobile: the tab row scrolls horizontally, so a deep link to a late tab
  // (Moderation, Settings) could land with the active tab off-screen. Keep it
  // in view. Guarded: jsdom has no scrollIntoView.
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = tabsRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  async function onSignOut() {
    await authClient.signOut();
    // Hard navigation (not router.navigate + invalidate): invalidating in place
    // re-renders this still-mounted authed tree with a now-dead session, so its
    // Convex queries throw "Server Error" and flash the error boundary before
    // the redirect lands. A full reload tears the tree down cleanly; the fresh
    // load reads no session and renders /login. `/cloud` is the router basepath.
    window.location.href = "/cloud/login";
  }

  return (
    <ConvexDataProvider>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="shrink-0 border-b border-border">
          <div className="flex h-14 items-center gap-2 px-4 md:px-6">
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
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          </div>
          <nav
            ref={tabsRef}
            aria-label="Dashboard sections"
            className="flex overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] md:px-4 [&::-webkit-scrollbar]:hidden"
          >
            {NAV.map((n) => (
              <Link
                key={n.id}
                to="/dashboard/$section"
                params={{ section: n.id }}
                aria-current={n.id === activeId ? "page" : undefined}
                className={
                  (n.id === activeId ? "@tab-active" : "@tab") +
                  " whitespace-nowrap"
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </ConvexDataProvider>
  );
}
