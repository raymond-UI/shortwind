import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <section className="@container-tight @stack-lg py-24">
      <div className="@stack-md">
        <p className="@muted font-medium uppercase tracking-wider">Shortwind</p>
        <h1 className="@heading-xl font-semibold sm:text-5xl">
          A token-efficient class layer for LLM-generated HTML.
        </h1>
        <p className="@lead">
          Write <code className="@code-inline">@card</code> instead of fifteen
          Tailwind tokens. Shortwind expands shorthands into full class clusters
          at build time — the runtime CSS is identical to plain Tailwind.
        </p>
      </div>
      <div className="@row flex-wrap gap-3">
        <Link to="/docs" className="@btn-primary">
          Read the docs
        </Link>
        <Link to="/catalog" className="@btn-secondary">
          Browse recipes
        </Link>
        <Link to="/playground" className="@btn-ghost">
          Open playground
        </Link>
      </div>
    </section>
  );
}
