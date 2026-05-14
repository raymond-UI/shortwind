import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { findDoc } from "../lib/docs-data";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

const getDoc = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => {
    if (typeof data.slug !== "string" || !SLUG_RE.test(data.slug)) {
      throw new Error("invalid slug");
    }
    return data;
  })
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
    <div className="@stack-sm">
      <p className="@muted font-medium uppercase tracking-wider">Docs</p>
      <h1 className="@heading-xl text-3xl font-semibold">{doc.title}</h1>
      {doc.description ? (
        <p className="@body text-base text-muted-foreground">
          {doc.description}
        </p>
      ) : null}
      <div
        className="prose prose-zinc mt-8 max-w-none dark:prose-invert prose-pre:bg-zinc-900 prose-pre:text-zinc-100"
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </div>
  );
}
