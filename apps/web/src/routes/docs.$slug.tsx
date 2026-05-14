import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/$slug")({
  component: DocsDetail,
});

function DocsDetail() {
  const { slug } = Route.useParams();
  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
        Docs
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
        {slug}
      </h1>
      <p className="mt-4 text-slate-600">
        Coming soon — content for this page will land with the docs route in a
        later issue.
      </p>
    </div>
  );
}
