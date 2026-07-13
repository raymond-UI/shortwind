import { Link, useRouteContext } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * The shared public site header — one definition used by the marketing landing
 * page AND the legal pages so they read as one product and can't drift. Auth-
 * aware: it reads `isAuthenticated` from the root route context (provided by
 * `__root` for every route), swapping the sign-in/get-started CTAs for an
 * "Open dashboard" link when signed in. `font-mono` is set here so the header is
 * identical whether the page root is mono (landing) or sans (legal prose).
 */
export function SiteHeader() {
  const ctx = useRouteContext({ strict: false }) as {
    isAuthenticated?: boolean;
  };
  const isAuthenticated = ctx.isAuthenticated ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 font-mono backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a
          href="https://shortwind.dev"
          className="flex items-center gap-1.5 text-sm font-bold tracking-tight"
        >
          <span className="text-term">▚</span>
          <span>shortwind</span>
          <span className="text-muted-foreground">Cloud</span>
        </a>
        <nav className="flex items-center gap-2 text-xs">
          <a
            href="https://shortwind.dev/docs/cloud"
            className="hidden rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
          >
            docs
          </a>
          {isAuthenticated ? (
            <Link
              to="/dashboard/$section"
              params={{ section: "overview" }}
              className="rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary"
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="sw-btn-primary rounded-md px-3 py-1.5 font-medium"
              >
                Get started
              </Link>
            </>
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
