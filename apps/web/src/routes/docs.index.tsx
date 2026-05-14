import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { findDoc } from "../lib/docs-data";

const getIndex = createServerFn({ method: "GET" }).handler(() => {
  const doc = findDoc("index");
  if (!doc) return null;
  return { title: doc.frontmatter.title, html: doc.html };
});

export const Route = createFileRoute("/docs/")({
  loader: () => getIndex(),
  component: DocsIndex,
});

function DocsIndex() {
  const doc = Route.useLoaderData();
  if (!doc) {
    return (
      <p className="text-slate-600">Documentation index not found.</p>
    );
  }
  return (
    <div
      className="prose prose-slate max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100"
      dangerouslySetInnerHTML={{ __html: doc.html }}
    />
  );
}
