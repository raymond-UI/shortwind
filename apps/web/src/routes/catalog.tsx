import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
});

function CatalogPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Recipe catalog
      </h1>
      <p className="mt-4 text-slate-600">
        Coming soon — a browsable index of every recipe in the default Shortwind
        registry, with previews and one-click copy.
      </p>
    </section>
  );
}
