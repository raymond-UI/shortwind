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
    <section className="@container py-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[14rem_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-6">
            <p className="@caption mb-3 font-semibold uppercase tracking-wider">
              Documentation
            </p>
            <ul className="@stack-xs text-sm">
              {pages.map((p) =>
                p.slug === "index" ? (
                  <li key={p.slug}>
                    <Link
                      to="/docs"
                      className="@nav-link block"
                      activeProps={{ className: "@nav-link-active block" }}
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
                      className="@nav-link block"
                      activeProps={{ className: "@nav-link-active block" }}
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
