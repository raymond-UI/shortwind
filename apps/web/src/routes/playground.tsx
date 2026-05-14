import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/playground")({
  component: PlaygroundPage,
});

function PlaygroundPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Playground
      </h1>
      <p className="mt-4 text-slate-600">
        Coming soon — paste an HTML snippet and watch Shortwind expand the
        recipes live.
      </p>
    </section>
  );
}
