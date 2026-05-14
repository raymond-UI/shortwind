import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { findDoc } from "../lib/docs-data";

const getDoc = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(({ data }) => {
    const doc = findDoc(data.slug);
    if (!doc) return null;
    return {
      slug: doc.slug,
      title: doc.frontmatter.title,
      description: doc.frontmatter.description,
      html: doc.html,
    };
  });

export const Route = createFileRoute("/docs/$slug")({
  loader: async ({ params }) => {
    const doc = await getDoc({ data: { slug: params.slug } });
    if (!doc) throw notFound();
    return doc;
  },
  component: DocsDetail,
});

function DocsDetail() {
  const doc = Route.useLoaderData();
  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
        Docs
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
        {doc.title}
      </h1>
      {doc.description ? (
        <p className="mt-2 text-slate-600">{doc.description}</p>
      ) : null}
      <div
        className="prose prose-slate mt-8 max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100"
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </div>
  );
}
