import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
});

function DocsIndex() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Documentation
      </h1>
      <p className="mt-4 text-slate-600">
        Coming soon — getting-started, architecture, recipe authoring, and the
        upgrade story.
      </p>
    </div>
  );
}
