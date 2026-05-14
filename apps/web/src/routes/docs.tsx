import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { loadDocs } from "../lib/docs-data";

const listDocs = createServerFn({ method: "GET" }).handler(() =>
  loadDocs().map((d) => ({
    slug: d.slug,
    title: d.frontmatter.title,
    description: d.frontmatter.description,
  })),
);

export const Route = createFileRoute("/docs")({
  loader: () => listDocs(),
  component: DocsLayout,
});

function DocsLayout() {
  const pages = Route.useLoaderData();
  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[14rem_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Documentation
            </p>
            <ul className="space-y-1 text-sm">
              {pages.map((p) =>
                p.slug === "index" ? (
                  <li key={p.slug}>
                    <Link
                      to="/docs"
                      className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      activeProps={{ className: "bg-slate-100 text-slate-900" }}
                      activeOptions={{ exact: true }}
                    >
                      {p.title}
                    </Link>
                  </li>
                ) : (
                  <li key={p.slug}>
                    <Link
                      to="/docs/$slug"
                      params={{ slug: p.slug }}
                      className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      activeProps={{ className: "bg-slate-100 text-slate-900" }}
                      activeOptions={{ exact: true }}
                    >
                      {p.title}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        </nav>
        <article>
          <Outlet />
        </article>
      </div>
    </section>
  );
}
