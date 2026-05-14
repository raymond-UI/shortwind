import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <Outlet />
    </section>
  );
}
