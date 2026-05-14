import type { ReactNode } from "react";
import {
  Outlet,
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";

// Source of truth for cross-page references to the project's GitHub repo.
// Update here when the repository moves; the placeholder `anthropics/shortwind`
// org was wrong and quietly 404'd from the header link.
export const GITHUB_REPO_URL = "https://github.com/shortwind/shortwind";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Shortwind — token-efficient class layer for LLM HTML" },
      {
        name: "description",
        content:
          "Shortwind expands @recipe shortcuts into Tailwind class clusters at build time. Smaller LLM artifacts, identical CSS.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="@surface flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </RootDocument>
  );
}

function SiteHeader() {
  return (
    <header className="@surface border-b border-zinc-200 dark:border-zinc-800">
      <div className="@container @row-between py-4">
        <Link to="/" className="@heading-sm text-lg tracking-tight hover:text-zinc-700 dark:hover:text-zinc-300">
          Shortwind
        </Link>
        <nav className="@nav">
          <Link to="/catalog" className="@nav-link" activeProps={{ className: "@nav-link-active" }}>
            Catalog
          </Link>
          <Link to="/playground" className="@nav-link" activeProps={{ className: "@nav-link-active" }}>
            Playground
          </Link>
          <Link to="/docs" className="@nav-link" activeProps={{ className: "@nav-link-active" }}>
            Docs
          </Link>
          <a
            href={GITHUB_REPO_URL}
            className="@nav-link"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="@surface-muted border-t border-zinc-200 dark:border-zinc-800">
      <div className="@container flex flex-col items-start justify-between gap-3 py-6 sm:flex-row sm:items-center">
        <p className="@muted">© {new Date().getFullYear()} Shortwind</p>
        <nav className="@row gap-4">
          <Link to="/docs" className="@nav-link">
            Docs
          </Link>
          <a
            href={GITHUB_REPO_URL}
            className="@nav-link"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </nav>
      </div>
    </footer>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
