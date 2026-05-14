import type { ReactNode } from "react";
import {
  Outlet,
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";

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
      <div className="flex min-h-screen flex-col bg-white text-slate-900">
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
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight text-slate-900 hover:text-slate-700"
        >
          Shortwind
        </Link>
        <nav className="flex items-center gap-6 text-sm text-slate-600">
          <Link to="/catalog" className="hover:text-slate-900" activeProps={{ className: "text-slate-900" }}>
            Catalog
          </Link>
          <Link to="/playground" className="hover:text-slate-900" activeProps={{ className: "text-slate-900" }}>
            Playground
          </Link>
          <Link to="/docs" className="hover:text-slate-900" activeProps={{ className: "text-slate-900" }}>
            Docs
          </Link>
          <a
            href="https://github.com/anthropics/shortwind"
            className="hover:text-slate-900"
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
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-6 text-sm text-slate-500 sm:flex-row sm:items-center">
        <p>© {new Date().getFullYear()} Shortwind</p>
        <nav className="flex gap-4">
          <Link to="/docs" className="hover:text-slate-700">
            Docs
          </Link>
          <a
            href="https://github.com/anthropics/shortwind"
            className="hover:text-slate-700"
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
