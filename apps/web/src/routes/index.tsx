import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <p className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
        Shortwind
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        A token-efficient class layer for LLM-generated HTML.
      </h1>
      <p className="mt-6 text-lg text-slate-600">
        Write <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800">@card</code>{" "}
        instead of fifteen Tailwind tokens. Shortwind expands shorthands into
        full class clusters at build time — the runtime CSS is identical to
        plain Tailwind.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          to="/docs"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Read the docs
        </Link>
        <Link
          to="/catalog"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          Browse recipes
        </Link>
        <Link
          to="/playground"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          Open playground
        </Link>
      </div>
    </section>
  );
}
